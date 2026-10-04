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
  private readonly resend: Resend | null = null;
  private readonly fromEmail: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY', '');
    this.fromEmail = this.config.get<string>('RESEND_FROM_EMAIL') ||
                     this.config.get<string>('NOTIFICATIONS_FROM_EMAIL') ||
                     'NEXORA Notificaciones <onboarding@resend.dev>';
    
    if (apiKey && apiKey !== '') {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn('⚠️ RESEND_API_KEY no configurada. El envío de correos se simulará en la consola.');
    }
  }

  async send(payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
    if (!this.resend) {
      this.logger.log(`[SIMULADO EMAIL] De: ${this.fromEmail} | Para: ${payload.destinatario} | Asunto: ${payload.asunto}`);
      this.logger.debug(`[SIMULADO EMAIL CUERPO]: ${payload.cuerpoHtml}`);
      return { success: true };
    }

    try {
      let response = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.destinatario,
        subject: payload.asunto,
        html: payload.cuerpoHtml,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
      });

      if (
        response.error &&
        (response.error.message.includes('only send testing emails') ||
          response.error.message.includes('testing emails'))
      ) {
        const systemEmail =
          this.config.get<string>('SYSTEM_EMAIL') ||
          this.config.get<string>('SMTP_USER') ||
          'nexora.appv01@gmail.com';

        this.logger.warn(
          `⚠️ [Resend Sandbox] Cuenta gratuita de Resend en modo prueba. Entregando a correo principal del sistema (${systemEmail}) para destinatario (${payload.destinatario}).`,
        );

        const devHtml = `
          <div style="background: #1e293b; color: #38bdf8; padding: 12px 16px; border-radius: 12px; margin-bottom: 20px; font-size: 13px; font-family: sans-serif; border: 1px solid rgba(56, 189, 248, 0.3);">
            <strong>ℹ️ Modo de Prueba / Notificación del Sistema:</strong><br />
            Notificación generada para: <strong style="color: #fff;">${payload.destinatario}</strong>.<br />
            Buzón central del sistema: <a href="mailto:${systemEmail}" style="color: #38bdf8;">${systemEmail}</a>.
          </div>
          ${payload.cuerpoHtml}
        `;

        response = await this.resend.emails.send({
          from: this.fromEmail,
          to: systemEmail,
          subject: `[Para: ${payload.destinatario}] ${payload.asunto}`,
          html: devHtml,
          replyTo: systemEmail,
        });
      }

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      this.logger.log(`📧 Email enviado exitosamente — ID: ${response.data?.id}`);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`❌ Error Resend: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

