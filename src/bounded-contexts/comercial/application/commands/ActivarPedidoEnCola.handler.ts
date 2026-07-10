import { Inject, Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { IOrderQueueRepository } from '../../domain/IOrderQueueRepository';
import { ActivarPedidoEnColaCommand } from './ActivarPedidoEnCola.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { ReservarStockHandler } from '../../../inventario/application/commands/ReservarStock.handler';
import { ReservarStockCommand } from '../../../inventario/application/commands/ReservarStock.command';
import { ComprometerCreditoHandler } from '../../../clientes/application/commands/ComprometerCredito.handler';
import { ComprometerCreditoCommand } from '../../../clientes/application/commands/ComprometerCredito.command';
import { ClientesQueryService } from '../../../clientes/application/queries/ClientesQueryService';
import { PedidoEnColaActivadoEvent, PedidoEnColaRetenidoPorCreditoEvent } from '../../domain/events/PedidoEvents';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class ActivarPedidoEnColaHandler {
  private readonly logger = new Logger(ActivarPedidoEnColaHandler.name);

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

  async execute(command: ActivarPedidoEnColaCommand): Promise<boolean> {
    const pedido = await this.pedidoRepository.findById(command.orderId);
    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${command.orderId}" no existe`);
    }

    // 1. Validar si hay stock físico disponible suficiente para todas las líneas
    for (const line of pedido.lineas) {
      const stockTalla = await this.prisma.stockByTalla.findUnique({
        where: { productId_tallaId: { productId: line.productId, tallaId: line.tallaId } },
      });

      if (!stockTalla || (stockTalla.quantity - stockTalla.reservedQuantity) < line.cantidad) {
        this.logger.warn(`Pedido ${pedido.id} no puede activarse por stock insuficiente en talla ${line.tallaId}`);
        return false; // No hay stock suficiente, permanece en cola
      }
    }

    // 2. Si es a CRÉDITO, revalidar capacidad crediticia del cliente
    if (pedido.tipoPago.value === 'CREDITO') {
      const scoring = await this.clientesQueryService.validarCapacidadCrediticia(
        pedido.clientId,
        pedido.montoTotal.amount,
      );

      if (!scoring.aprobado) {
        this.logger.warn(`Pedido ${pedido.id} retenido en cola por capacidad crediticia insuficiente.`);
        // Registrar evento de retención en cola por crédito
        const event = new PedidoEnColaRetenidoPorCreditoEvent(
          pedido.id,
          pedido.clientId,
          scoring.razon || 'Crédito insuficiente',
          pedido.montoTotal.amount,
          scoring.limiteDisponible,
        );
        // Despachamos evento al bus (en el aggregate se agrega o despacha directamente aquí en aplicación)
        return false;
      }
    }

    // 3. Confirmar pedido y transicionar a PENDIENTE
    pedido.confirmar();

    // 4. Reservar el stock en Inventario
    for (const line of pedido.lineas) {
      await this.reservarStockHandler.execute(
        new ReservarStockCommand(
          line.productId,
          line.tallaId,
          line.cantidad,
          'ACTIVACION_PEDIDO_EN_COLA',
          pedido.id,
          1440,
        ),
      );
    }

    // 5. Comprometer el crédito del cliente si es crédito
    if (pedido.tipoPago.value === 'CREDITO') {
      await this.comprometerCreditoHandler.execute(
        new ComprometerCreditoCommand(pedido.clientId, pedido.montoTotal.amount),
      );
    }

    // 6. Desactivar entrada en la cola de prioridad
    const qEntry = await this.queueRepository.findActiveByOrderId(pedido.id);
    if (qEntry) {
      await this.queueRepository.deactivate(qEntry.id);
    }

    // Guardar cambios
    await this.pedidoRepository.update(pedido);

    this.logger.log(`Pedido ${pedido.id} activado exitosamente desde la cola.`);
    return true;
  }
}
