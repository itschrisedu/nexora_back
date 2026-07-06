/**
 * NotificationPayload — Value Object que encapsula los datos de una notificación.
 */
export type NotificationCanal = 'EMAIL' | 'WHATSAPP';

export interface NotificationPayload {
  readonly canal: NotificationCanal;
  readonly destinatario: string;
  readonly asunto: string;
  readonly cuerpoHtml: string;
  readonly eventoOrigen: string;
}
