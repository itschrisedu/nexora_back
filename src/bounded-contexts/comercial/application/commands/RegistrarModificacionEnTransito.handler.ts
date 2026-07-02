import { Injectable } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { LineaRechazadaPrimitive } from '../../domain/events/PedidoEvents';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

/**
 * RegistrarModificacionEnTransitoHandler
 * Aplica un rechazo parcial de líneas cuando el pedido está EN_TRANSITO.
 * Libera stock y crédito parcial según corresponda.
 */
// Handler de aplicación para registrar modificaciones en tránsito.
@Injectable()
export class RegistrarModificacionEnTransitoHandler {
  constructor(
    private readonly pedidoRepo: IPedidoRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: {
    pedidoId: string;
    lineasRechazadas: LineaRechazadaPrimitive[];
    userId: string;
  }): Promise<void> {
    const pedido = await this.pedidoRepo.findById(command.pedidoId);
    if (!pedido) {
      throw new Error(`Pedido ${command.pedidoId} no encontrado`);
    }

    const montoOriginal = pedido.montoTotal.amount;

    // Aplicar modificación en el aggregate (valida estado EN_TRANSITO)
    pedido.registrarModificacionEnTransito(command.lineasRechazadas);

    // Persistir el pedido actualizado
    await this.pedidoRepo.update(pedido);

    // Registrar la modificación en OrderModification para auditoría
    await this.prisma.orderModification.create({
      data: {
        orderId: command.pedidoId,
        tipoModificacion: pedido.estado.value === 'CANCELADO' ? 'CANCELACION_TOTAL' : 'RECHAZO_PARCIAL',
        montoOriginal,
        montoNuevo: pedido.montoTotal.amount,
        lineasRechazadas: command.lineasRechazadas as any,
        userId: command.userId,
      },
    });

    // Marcar líneas rechazadas en DispatchOrder
    for (const lineaRechazada of command.lineasRechazadas) {
      await this.prisma.dispatchOrderLine.updateMany({
        where: {
          dispatch: { orderId: command.pedidoId },
          productId: lineaRechazada.productId,
          tallaId: lineaRechazada.tallaId,
        },
        data: { aceptada: false },
      });
    }

    // Publicar eventos de dominio
    const events = pedido.clearDomainEvents();
    for (const event of events) {
      this.eventBus.publish(event);
    }
  }
}
