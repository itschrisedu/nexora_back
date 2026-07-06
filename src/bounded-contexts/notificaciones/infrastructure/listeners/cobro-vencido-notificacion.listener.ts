import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificacionService } from '../../application/NotificacionService';
import { CobroVencidoSinPagoEvent, VencimientoCobroEvent } from '../../../financiero/domain/events/FinancieroEvents';
import { cobroVencidoTemplate } from '../../application/templates/cobro-vencido.template';

/**
 * Listener que envía notificaciones cuando un cobro vence o ya venció sin pago.
 */
@Injectable()
export class CobroVencidoNotificacionListener {
  private readonly logger = new Logger(CobroVencidoNotificacionListener.name);

  constructor(private readonly notificacionService: NotificacionService) {}

  @OnEvent('CobroVencidoSinPago')
  async onCobroVencido(event: CobroVencidoSinPagoEvent): Promise<void> {
    const email = await this.notificacionService.obtenerEmailCliente(event.clientId);
    if (!email) return;

    const nombre = await this.notificacionService.obtenerNombreCliente(event.clientId);

    const html = cobroVencidoTemplate({
      clienteNombre: nombre,
      cobroId: event.cobroId.slice(0, 8).toUpperCase(),
      saldoPendiente: event.saldoPendiente,
      diasVencido: event.diasVencido,
    });

    await this.notificacionService.enviar({
      canal: 'EMAIL',
      destinatario: email,
      asunto: `NEXORA — ⚠️ Cobro Vencido #${event.cobroId.slice(0, 8).toUpperCase()}`,
      cuerpoHtml: html,
      eventoOrigen: 'CobroVencidoSinPago',
    });
  }

  @OnEvent('VencimientoCobro')
  async onVencimientoProximo(event: VencimientoCobroEvent): Promise<void> {
    const email = await this.notificacionService.obtenerEmailCliente(event.clientId);
    if (!email) return;

    const nombre = await this.notificacionService.obtenerNombreCliente(event.clientId);

    const html = cobroVencidoTemplate({
      clienteNombre: nombre,
      cobroId: event.cobroId.slice(0, 8).toUpperCase(),
      saldoPendiente: event.saldoPendiente,
      diasVencido: 0, // Aún no venció, es preventivo
    });

    await this.notificacionService.enviar({
      canal: 'EMAIL',
      destinatario: email,
      asunto: `NEXORA — Recordatorio de Cobro Próximo a Vencer`,
      cuerpoHtml: html,
      eventoOrigen: 'VencimientoCobro',
    });
  }
}
