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
    await this.pedidoRepository.save(pedido, command.tenantId);

    // 6. Si falta stock, registrar en la cola de prioridad y enviar solicitud al proveedor si está vinculado
    if (estadoInicial === PrismaEstadoPedido.EN_ESPERA_STOCK) {
      const cli = await this.clientesQueryService.obtenerCliente(command.clientId);
      await this.queueRepository.save({
        orderId: pedidoId,
        clientId: command.clientId,
        prioridadFifo: pedido.createdAt,
        nivelCredito: cli.nivelCredito,
        totalHistorico: cli.totalCompras * 50,
        activa: true,
      });

      // Generar o acumular orden de compra automática al proveedor en estado BORRADOR
      try {
        const supplierGroups = new Map<string, { productId: string; cantidad: number; precioCosto: number; observacion: string }[]>();

        for (const line of lineasProducto) {
          if (line.stockDisponible < line.cantidad) {
            const faltante = line.cantidad - line.stockDisponible;
            // Pedir el faltante para cumplir el pedido + 1 docena extra (12 pares) para stock
            const cantidadAComprar = faltante + 12;

            const prodWithModel = await this.prisma.product.findUnique({
              where: { id: line.productId },
              include: { model: true },
            });

            // Obtener el proveedor vinculado o el primer proveedor activo de la empresa
            let supplierId = prodWithModel?.model?.supplierId;
            if (!supplierId) {
              const defaultSupplier = await this.prisma.supplier.findFirst({
                where: { activo: true },
              });
              supplierId = defaultSupplier?.id;
            }

            if (supplierId) {
              if (!supplierGroups.has(supplierId)) supplierGroups.set(supplierId, []);
              supplierGroups.get(supplierId)!.push({
                productId: line.productId,
                cantidad: cantidadAComprar,
                precioCosto: Number(prodWithModel?.costPrice || 10),
                observacion: `Cliente: ${cli?.nombre || 'Cliente'} | Ref Pedido: #${pedido.id.substring(0, 8)} (Faltante ${faltante} pares + 12 stock)`,
              });
            }
          }
        }

        for (const [supId, items] of supplierGroups.entries()) {
          // Buscar si ya existe una orden de compra en estado BORRADOR para este proveedor
          let borrador = await this.prisma.supplierOrder.findFirst({
            where: {
              supplierId: supId,
              estado: 'BORRADOR',
            },
            include: { lines: true },
          });

          if (!borrador) {
            borrador = await this.prisma.supplierOrder.create({
              data: {
                supplierId: supId,
                total: 0,
                estado: 'BORRADOR',
                observaciones: 'Orden acumulativa del día (Generada automáticamente por déficit de stock)',
              },
              include: { lines: true },
            });
          }

          // Anexar o acumular líneas en la orden borrador
          for (const item of items) {
            const existingLine = borrador.lines.find((l) => l.productId === item.productId);
            if (existingLine) {
              const nuevaCant = existingLine.cantidadPedida + item.cantidad;
              await this.prisma.supplierOrderLine.update({
                where: { id: existingLine.id },
                data: {
                  cantidadPedida: nuevaCant,
                  subtotal: nuevaCant * item.precioCosto,
                },
              });
            } else {
              await this.prisma.supplierOrderLine.create({
                data: {
                  supplierOrderId: borrador.id,
                  productId: item.productId,
                  cantidadPedida: item.cantidad,
                  precioCosto: item.precioCosto,
                  subtotal: item.cantidad * item.precioCosto,
                  observacionLinea: item.observacion,
                },
              });
            }
          }

          // Recalcular total acumulado de la orden borrador
          const allLines = await this.prisma.supplierOrderLine.findMany({
            where: { supplierOrderId: borrador.id },
          });
          const totalRecalculado = allLines.reduce((acc, l) => acc + Number(l.subtotal), 0);
          await this.prisma.supplierOrder.update({
            where: { id: borrador.id },
            data: { total: totalRecalculado },
          });
        }
      } catch (e) {
        // No bloquear la creación del pedido del cliente si ocurre una advertencia secundaria
      }
    }

    return pedido.id;
  }
}
