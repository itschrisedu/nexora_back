import { Injectable, Logger } from '@nestjs/common';
import { INotificationSender } from '../../domain/INotificationSender';
import { NotificationPayload } from '../../domain/NotificationPayload';

/**
 * WhatsAppSenderStub — Stub que logea el mensaje en consola.
 * Listo para ser reemplazado por Twilio/Meta API sin cambiar ningún listener.
 */
@Injectable()
export class WhatsAppSenderStub implements INotificationSender {
  private readonly logger = new Logger(WhatsAppSenderStub.name);

  async send(payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
    this.logger.log(
      `📱 [STUB WhatsApp] → ${payload.destinatario} | Asunto: ${payload.asunto} | Evento: ${payload.eventoOrigen}`,
    );

    // Simular envío exitoso
    return { success: true };
  }
}
