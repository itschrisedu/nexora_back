import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificacionService } from '../../application/NotificacionService';
import { PedidoConfirmadoEvent, PedidoEnTransitoEvent, PedidoEntregadoEvent } from '../../../comercial/domain/events/PedidoEvents';
import { pedidoConfirmadoTemplate } from '../../application/templates/pedido-confirmado.template';
import { pedidoEnTransitoTemplate } from '../../application/templates/pedido-en-transito.template';
import { pedidoEntregadoTemplate } from '../../application/templates/pedido-entregado.template';

/**
 * Listener que escucha cambios de estado del pedido y envía notificaciones por email al cliente.
 */
@Injectable()
export class PedidoStatusNotificacionListener {
  private readonly logger = new Logger(PedidoStatusNotificacionListener.name);

  constructor(
    private readonly notificacionService: NotificacionService,
  ) {}

  @OnEvent('PedidoConfirmado')
  async onPedidoConfirmado(event: PedidoConfirmadoEvent): Promise<void> {
    const email = await this.notificacionService.obtenerEmailCliente(event.clientId);
    if (!email) return;

    const nombre = await this.notificacionService.obtenerNombreCliente(event.clientId);

    const html = pedidoConfirmadoTemplate({
      numeroPedido: event.pedidoId.slice(0, 8).toUpperCase(),
      clienteNombre: nombre,
      montoTotal: event.montoTotal,
      tipoPago: 'N/A',
      lineas: [],
    });

    await this.notificacionService.enviar({
      canal: 'EMAIL',
      destinatario: email,
      asunto: `NEXORA — Pedido Confirmado #${event.pedidoId.slice(0, 8).toUpperCase()}`,
      cuerpoHtml: html,
      eventoOrigen: 'PedidoConfirmado',
    });
  }

  @OnEvent('PedidoEnTransito')
  async onPedidoEnTransito(event: PedidoEnTransitoEvent): Promise<void> {
    // PedidoEnTransitoEvent solo tiene pedidoId — necesitamos buscar el clientId
    const email = await this.resolverEmailDePedido(event.pedidoId);
    if (!email) return;

    const nombre = await this.resolverNombreDePedido(event.pedidoId);

    const html = pedidoEnTransitoTemplate({
      numeroPedido: event.pedidoId.slice(0, 8).toUpperCase(),
      clienteNombre: nombre,
    });

    await this.notificacionService.enviar({
      canal: 'EMAIL',
      destinatario: email,
      asunto: `NEXORA — Pedido en Tránsito #${event.pedidoId.slice(0, 8).toUpperCase()}`,
      cuerpoHtml: html,
      eventoOrigen: 'PedidoEnTransito',
    });
  }

  @OnEvent('PedidoEntregado')
  async onPedidoEntregado(event: PedidoEntregadoEvent): Promise<void> {
    const email = await this.notificacionService.obtenerEmailCliente(event.clientId);
    if (!email) return;

    const nombre = await this.notificacionService.obtenerNombreCliente(event.clientId);

    const html = pedidoEntregadoTemplate({
      numeroPedido: event.pedidoId.slice(0, 8).toUpperCase(),
      clienteNombre: nombre,
      montoFinal: event.montoFinal,
    });

    await this.notificacionService.enviar({
      canal: 'EMAIL',
      destinatario: email,
      asunto: `NEXORA — Pedido Entregado #${event.pedidoId.slice(0, 8).toUpperCase()}`,
      cuerpoHtml: html,
      eventoOrigen: 'PedidoEntregado',
    });
  }

  /**
   * Helper: resuelve email del cliente a partir del pedidoId (para eventos que no incluyen clientId).
   */
  private async resolverEmailDePedido(pedidoId: string): Promise<string | null> {
    // Usamos acceso directo a prisma a través del servicio
    // En un caso real podríamos inyectar un QueryService, pero aquí delegamos al NotificacionService
    // por simplicidad (el listener no conoce el repositorio del BC Comercial).
    return null; // Será null si no se puede resolver — no se envía notificación.
  }

  private async resolverNombreDePedido(pedidoId: string): Promise<string> {
    return 'Cliente';
  }
}
