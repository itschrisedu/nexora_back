import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import type { INotificationSender } from '../domain/INotificationSender';
import type { NotificationPayload } from '../domain/NotificationPayload';

/**
 * NotificacionService — Orquestador central de notificaciones.
 * Recibe datos de un evento, resuelve destinatario, selecciona canal y despacha.
 */
@Injectable()
export class NotificacionService {
  private readonly logger = new Logger(NotificacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('IEmailSender') private readonly emailSender: INotificationSender,
    @Inject('IWhatsAppSender') private readonly whatsAppSender: INotificationSender,
  ) {}

  /**
   * Envía una notificación y registra el resultado en NotificationLog.
   */
  async enviar(payload: NotificationPayload): Promise<void> {
    const sender = payload.canal === 'EMAIL' ? this.emailSender : this.whatsAppSender;

    try {
      const result = await sender.send(payload);

      await (this.prisma as any).notificationLog.create({
        data: {
          canal: payload.canal,
          destinatario: payload.destinatario,
          asunto: payload.asunto,
          eventoOrigen: payload.eventoOrigen,
          estado: result.success ? 'ENVIADO' : 'FALLIDO',
          error: result.error ?? null,
        },
      });

      if (result.success) {
        this.logger.log(`✅ Notificación ${payload.canal} enviada → ${payload.destinatario} [${payload.eventoOrigen}]`);
      } else {
        this.logger.warn(`⚠️ Notificación ${payload.canal} falló → ${payload.destinatario}: ${result.error}`);
      }
    } catch (error: any) {
      this.logger.error(`❌ Error al enviar notificación: ${error.message}`);

      // Registrar fallo en log de auditoría
      await (this.prisma as any).notificationLog.create({
        data: {
          canal: payload.canal,
          destinatario: payload.destinatario,
          asunto: payload.asunto,
          eventoOrigen: payload.eventoOrigen,
          estado: 'FALLIDO',
          error: error.message,
        },
      }).catch(() => { /* silently fail audit log */ });
    }
  }

  /**
   * Busca el email de un cliente por su ID.
   */
  async obtenerEmailCliente(clientId: string): Promise<string | null> {
    const client = await (this.prisma as any).client.findUnique({
      where: { id: clientId },
      select: { email: true },
    });
    return client?.email ?? null;
  }

  /**
   * Busca el nombre de un cliente por su ID.
   */
  async obtenerNombreCliente(clientId: string): Promise<string> {
    const client = await (this.prisma as any).client.findUnique({
      where: { id: clientId },
      select: { nombre: true },
    });
    return client?.nombre ?? 'Cliente';
  }
}
