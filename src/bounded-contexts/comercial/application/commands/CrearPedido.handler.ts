import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { IOrderQueueRepository } from '../../domain/IOrderQueueRepository';
import { Pedido } from '../../domain/Pedido';
import { LineaPedido } from '../../domain/LineaPedido';
import { CanalEntrada } from '../../domain/value-objects/CanalEntrada';
import { TipoPago } from '../../domain/value-objects/TipoPago';
import { TipoVenta } from '../../domain/value-objects/TipoVenta';
import { CrearPedidoCommand } from './CrearPedido.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { ReservarStockHandler } from '../../../inventario/application/commands/ReservarStock.handler';
import { ReservarStockCommand } from '../../../inventario/application/commands/ReservarStock.command';
import { ComprometerCreditoHandler } from '../../../clientes/application/commands/ComprometerCredito.handler';
import { ComprometerCreditoCommand } from '../../../clientes/application/commands/ComprometerCredito.command';
import { ClientesQueryService } from '../../../clientes/application/queries/ClientesQueryService';
import { Money } from '../../../../shared/domain/Money';
import { EstadoPedido as PrismaEstadoPedido } from '@prisma/client';

@Injectable()
export class CrearPedidoHandler {
  constructor(
    @Inject('IPedidoRepository')
    private readonly pedidoRepository: IPedidoRepository,
    @Inject('IOrderQueueRepository')
    private readonly queueRepository: IOrderQueueRepository,
    private readonly prisma: PrismaService,
    private readonly reservarStockHandler: ReservarStockHandler,
    private readonly comprometerCreditoHandler: ComprometerCreditoHandler,
    private readonly clientesQueryService: ClientesQueryService,
  ) {}

  async execute(command: CrearPedidoCommand): Promise<string> {
    // 1. Obtener datos de productos y validar existencias
    const lineasProducto: {
      productId: string;
      tallaId: string;
      serieId: string;
      cantidad: number;
      precioUnitario: Money;
      tipoVenta: TipoVenta;
      stockDisponible: number;
    }[] = [];

    let totalAcumulado = 0;
    let tieneStockParaTodo = true;

    for (const lineaInput of command.lineas) {
      const prod = await this.prisma.product.findUnique({
        where: { id: lineaInput.productId },
        include: { stockByTalla: true },
      });

      if (!prod) {
        throw new NotFoundException(`El producto con ID "${lineaInput.productId}" no existe`);
      }

      const stockTalla = prod.stockByTalla.find((s) => s.tallaId === lineaInput.tallaId);
      if (!stockTalla) {
        throw new BadRequestException(
          `La talla con ID "${lineaInput.tallaId}" no está configurada para el producto "${prod.code}"`,
        );
      }

      const disponible = stockTalla.quantity - stockTalla.reservedQuantity;
      if (disponible < lineaInput.cantidad) {
        tieneStockParaTodo = false;
      }

      const precioUnit = Money.create(Number(prod.salePrice));
      totalAcumulado += precioUnit.amount * lineaInput.cantidad;

      lineasProducto.push({
        productId: lineaInput.productId,
        tallaId: lineaInput.tallaId,
        serieId: prod.serieId,
        cantidad: lineaInput.cantidad,
        precioUnitario: precioUnit,
        tipoVenta: TipoVenta.create(lineaInput.tipoVenta),
        stockDisponible: disponible,
      });
    }

    // 2. Validar capacidad crediticia si el pago es a CRÉDITO
    if (command.tipoPago === 'CREDITO') {
      const scoring = await this.clientesQueryService.validarCapacidadCrediticia(
        command.clientId,
        totalAcumulado,
      );

      if (!scoring.aprobado) {
        throw new BadRequestException(
          `Venta a crédito rechazada para el cliente. Razón: ${scoring.razon}`,
        );
      }
    }

    // 3. Determinar estado inicial y realizar reservas si hay stock suficiente
    const estadoInicial = tieneStockParaTodo
      ? PrismaEstadoPedido.PENDIENTE
      : PrismaEstadoPedido.EN_ESPERA_STOCK;

    const pedidoId = crypto.randomUUID();

    // Reconstruir entidades de LineaPedido
    const domainLineas = lineasProducto.map((line) =>
      LineaPedido.crear(
        crypto.randomUUID(),
        line.productId,
        line.serieId,
        line.tallaId,
        line.cantidad,
        line.precioUnitario,
        line.tipoVenta,
      ),
    );

    // Si hay stock disponible de todo, reservar físicamente en inventario (TTL 24 horas)
    if (estadoInicial === PrismaEstadoPedido.PENDIENTE) {
      for (const line of domainLineas) {
        await this.reservarStockHandler.execute(
          new ReservarStockCommand(
            line.productId,
            line.tallaId,
            line.cantidad,
            'RESERVA_PEDIDO_AUTOMATICA',
            pedidoId,
            1440, // 24 horas (TTL)
          ),
        );
      }
    }

    // 4. Comprometer el crédito del cliente si es crédito aprobado
    if (command.tipoPago === 'CREDITO' && estadoInicial === PrismaEstadoPedido.PENDIENTE) {
      await this.comprometerCreditoHandler.execute(
        new ComprometerCreditoCommand(command.clientId, totalAcumulado),
      );
    }

    // 5. Crear el pedido agregador
    const pedido = Pedido.crear(
      pedidoId,
      command.clientId,
      CanalEntrada.create(command.canal),
      TipoPago.create(command.tipoPago),
      domainLineas,
      estadoInicial,
      command.userId,
    );

    // Persistir el pedido
    await this.pedidoRepository.save(pedido);

    // 6. Si falta stock, registrar en la cola de prioridad
    if (estadoInicial === PrismaEstadoPedido.EN_ESPERA_STOCK) {
      const cli = await this.clientesQueryService.obtenerCliente(command.clientId);
      await this.queueRepository.save({
        orderId: pedidoId,
        clientId: command.clientId,
        prioridadFifo: pedido.createdAt,
        nivelCredito: cli.nivelCredito,
        totalHistorico: cli.totalCompras * 50, // aproximación para total histórico
        activa: true,
      });
    }

    return pedido.id;
  }
}
