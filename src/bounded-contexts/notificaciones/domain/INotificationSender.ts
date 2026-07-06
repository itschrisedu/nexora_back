import { NotificationPayload } from './NotificationPayload';

/**
 * Puerto (interfaz) para enviar notificaciones.
 * Cada canal (Email, WhatsApp) implementa este contrato.
 */
export interface INotificationSender {
  send(payload: NotificationPayload): Promise<{ success: boolean; error?: string }>;
}
