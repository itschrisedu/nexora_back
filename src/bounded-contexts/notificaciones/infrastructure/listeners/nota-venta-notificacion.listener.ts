import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificacionService } from '../../application/NotificacionService';
import { NotaVentaGeneradaEvent } from '../../../financiero/domain/events/FinancieroEvents';
import { notaVentaGeneradaTemplate } from '../../application/templates/nota-venta-generada.template';

/**
 * Listener que envía un email al cliente cuando se genera su nota de venta.
 */
@Injectable()
export class NotaVentaNotificacionListener {
  private readonly logger = new Logger(NotaVentaNotificacionListener.name);

  constructor(private readonly notificacionService: NotificacionService) {}

  @OnEvent('NotaVentaGenerada')
  async onNotaVentaGenerada(event: NotaVentaGeneradaEvent): Promise<void> {
    const email = await this.notificacionService.obtenerEmailCliente(event.clientId);
    if (!email) return;

    const nombre = await this.notificacionService.obtenerNombreCliente(event.clientId);

    const html = notaVentaGeneradaTemplate({
      clienteNombre: nombre,
      numeroNota: event.numero,
      total: event.total,
    });

    await this.notificacionService.enviar({
      canal: 'EMAIL',
      destinatario: email,
      asunto: `NEXORA — Nota de Venta #${event.numero}`,
      cuerpoHtml: html,
      eventoOrigen: 'NotaVentaGenerada',
    });
  }
}
