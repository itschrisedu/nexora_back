import { Injectable } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

/**
 * ConfirmarEntregaHandler
 * Confirma la entrega del pedido al cliente.
 * Emite PedidoEntregado para que otros BCs reaccionen
 * (Financiero: crear cobro, Clientes: registrar compra completada).
 */
@Injectable()
export class ConfirmarEntregaHandler {
  constructor(
    private readonly pedidoRepo: IPedidoRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: { pedidoId: string; userId: string }): Promise<void> {
    const pedido = await this.pedidoRepo.findById(command.pedidoId);
    if (!pedido) {
      throw new Error(`Pedido ${command.pedidoId} no encontrado`);
    }

    // Confirmar entrega (valida estado EN_TRANSITO o MODIFICADO)
    pedido.confirmarEntrega();

    // Persistir
    await this.pedidoRepo.update(pedido);

    // Publicar eventos de dominio (PedidoEntregado)
    const events = pedido.clearDomainEvents();
    for (const event of events) {
      this.eventBus.publish(event);
    }
  }
}
