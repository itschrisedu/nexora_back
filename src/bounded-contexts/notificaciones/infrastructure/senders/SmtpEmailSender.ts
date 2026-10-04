import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { INotificationSender } from '../../domain/INotificationSender';
import { NotificationPayload } from '../../domain/NotificationPayload';

/**
 * SmtpEmailSender — Adaptador universal de envío de correos electrónicos.
 * Soporta:
 *  1. Cuentas directas de Gmail (smtp.gmail.com) con contraseña de aplicación.
 *  2. Cuentas de Hotmail / Outlook (smtp-mail.outlook.com).
 *  3. Cuentas de Yahoo (smtp.mail.yahoo.com).
 *  4. Servidores SMTP genéricos / corporativos.
 *  5. Resend API como fallback si está configurado.
 *  6. Modo simulado en consola para desarrollo o cuando no hay credenciales.
 */
@Injectable()
export class SmtpEmailSender implements INotificationSender {
  private readonly logger = new Logger(SmtpEmailSender.name);
  private transporter: Transporter | null = null;
  private resend: Resend | null = null;
  private fromEmail: string;
  private fromName: string;

  constructor(private readonly config: ConfigService) {
    this.fromEmail = this.config.get<string>('SMTP_USER') ||
                     this.config.get<string>('NOTIFICATIONS_FROM_EMAIL') ||
                     'notificaciones@nexoracalzado.com';
    this.fromName = this.config.get<string>('NOTIFICATIONS_FROM_NAME') || 'NEXORA Calzado';

    this.inicializarTransportador();
  }

  private inicializarTransportador() {
    const smtpUser = this.config.get<string>('SMTP_USER');
    const smtpPass = this.config.get<string>('SMTP_PASS');
    const smtpService = this.config.get<string>('SMTP_SERVICE')?.toLowerCase(); // 'gmail' | 'hotmail' | 'outlook' | 'yahoo'
    let smtpHost = this.config.get<string>('SMTP_HOST');
    let smtpPort = Number(this.config.get<number | string>('SMTP_PORT')) || 587;
    let smtpSecure = this.config.get<string>('SMTP_SECURE') === 'true' || smtpPort === 465;

    // Auto-detección por dominio de correo si no se especificó host explícito
    if (smtpUser && !smtpHost && !smtpService) {
      if (smtpUser.endsWith('@gmail.com')) {
        smtpHost = 'smtp.gmail.com';
        smtpPort = 465;
        smtpSecure = true;
      } else if (smtpUser.endsWith('@hotmail.com') || smtpUser.endsWith('@outlook.com') || smtpUser.endsWith('@live.com')) {
        smtpHost = 'smtp-mail.outlook.com';
        smtpPort = 587;
        smtpSecure = false;
      } else if (smtpUser.endsWith('@yahoo.com') || smtpUser.endsWith('@yahoo.es')) {
        smtpHost = 'smtp.mail.yahoo.com';
        smtpPort = 465;
        smtpSecure = true;
      }
    }

    if (smtpUser && smtpPass) {
      if (smtpService) {
        // Conexión por servicio conocido (nodemailer preconfigurado)
        this.transporter = nodemailer.createTransport({
          service: smtpService,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });
        this.logger.log(`📧 Servicio de correo SMTP [${smtpService.toUpperCase()}] inicializado con usuario: ${smtpUser}`);
      } else if (smtpHost) {
        // Conexión por host SMTP explícito
        this.transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
          tls: {
            rejectUnauthorized: false, // Evita fallos con certificados autofirmados
          },
        });
        this.logger.log(`📧 Servidor SMTP [${smtpHost}:${smtpPort}] inicializado con usuario: ${smtpUser}`);
      }
    }

    // Fallback: Si no hay SMTP configurado, verificar si existe Resend
    if (!this.transporter) {
      const resendApiKey = this.config.get<string>('RESEND_API_KEY');
      if (resendApiKey) {
        this.resend = new Resend(resendApiKey);
        this.logger.log(`📧 Servicio de correo Resend inicializado con remitente: ${this.fromEmail}`);
      } else {
        this.logger.warn(
          '⚠️ No se detectaron credenciales SMTP (Gmail/Hotmail/Yahoo) ni RESEND_API_KEY. Los correos se simularán de forma segura en consola.',
        );
      }
    }
  }

  async send(payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
    const nombreEmisor = payload.fromName || this.fromName;
    const remitenteCompleto = `"${nombreEmisor}" <${this.fromEmail}>`;

    // 1. Envío mediante SMTP (Gmail, Hotmail, Yahoo, Custom)
    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: remitenteCompleto,
          to: payload.destinatario,
          subject: payload.asunto,
          html: payload.cuerpoHtml,
          ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
        });

        this.logger.log(`📧 Correo SMTP enviado a ${payload.destinatario} | MessageId: ${info.messageId}`);
        return { success: true };
      } catch (error: any) {
        this.logger.error(`❌ Error al enviar correo por SMTP (${payload.destinatario}): ${error.message}`);
        return { success: false, error: error.message };
      }
    }

    // 2. Envío mediante Resend (Fallback)
    if (this.resend) {
      try {
        const resendFrom = this.config.get<string>('RESEND_FROM_EMAIL') || `${nombreEmisor} <onboarding@resend.dev>`;
        const response = await this.resend.emails.send({
          from: resendFrom,
          to: payload.destinatario,
          subject: payload.asunto,
          html: payload.cuerpoHtml,
          replyTo: payload.replyTo || this.fromEmail,
        });

        if (response.error) {
          return { success: false, error: response.error.message };
        }

        this.logger.log(`📧 Correo Resend enviado a ${payload.destinatario} — ID: ${response.data?.id}`);
        return { success: true };
      } catch (error: any) {
        this.logger.error(`❌ Error Resend (${payload.destinatario}): ${error.message}`);
        return { success: false, error: error.message };
      }
    }

    // 3. Simulación limpia en consola (Desarrollo / Sin credenciales)
    this.logger.log(
      `[SIMULADO EMAIL] De: ${remitenteCompleto} | Para: ${payload.destinatario} | Asunto: ${payload.asunto}`,
    );
    return { success: true };
  }
}
