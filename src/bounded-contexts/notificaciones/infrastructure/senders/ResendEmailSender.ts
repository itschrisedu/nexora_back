import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { INotificationSender } from '../../domain/INotificationSender';
import { NotificationPayload } from '../../domain/NotificationPayload';

/**
 * ResendEmailSender — Adaptador que usa el SDK de Resend para enviar correos.
 */
@Injectable()
export class ResendEmailSender implements INotificationSender {
  private readonly logger = new Logger(ResendEmailSender.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY', '');
    this.resend = new Resend(apiKey);
    this.fromEmail = this.config.get<string>('NOTIFICATIONS_FROM_EMAIL', 'nexora@example.com');
  }

  async send(payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.destinatario,
        subject: payload.asunto,
        html: payload.cuerpoHtml,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      this.logger.log(`📧 Email enviado a ${payload.destinatario} — ID: ${response.data?.id}`);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`❌ Error Resend: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
