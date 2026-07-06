import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Application
import { NotificacionService } from '../application/NotificacionService';

// Infrastructure — Senders
import { ResendEmailSender } from './senders/ResendEmailSender';
import { WhatsAppSenderStub } from './senders/WhatsAppSenderStub';

// Infrastructure — Listeners
import { PedidoStatusNotificacionListener } from './listeners/pedido-status-notificacion.listener';
import { CobroVencidoNotificacionListener } from './listeners/cobro-vencido-notificacion.listener';
import { NotaVentaNotificacionListener } from './listeners/nota-venta-notificacion.listener';

// Infrastructure — Cron
import { CobrosVencimientoCron } from './cron/cobros-vencimiento.cron';

@Module({
  imports: [ConfigModule],
  providers: [
    // Senders (inyectados por token)
    {
      provide: 'IEmailSender',
      useClass: ResendEmailSender,
    },
    {
      provide: 'IWhatsAppSender',
      useClass: WhatsAppSenderStub,
    },

    // Servicio orquestador
    NotificacionService,

    // Event Listeners
    PedidoStatusNotificacionListener,
    CobroVencidoNotificacionListener,
    NotaVentaNotificacionListener,

    // Cron Jobs
    CobrosVencimientoCron,
  ],
  exports: [NotificacionService],
})
export class NotificacionesModule {}
