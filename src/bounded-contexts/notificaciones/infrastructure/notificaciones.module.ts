import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Application
import { NotificacionService } from '../application/NotificacionService';
import { NotificacionesQueryService } from '../application/queries/NotificacionesQueryService';

// Controllers
import { NotificacionesController } from './notificaciones.controller';

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
  controllers: [NotificacionesController],
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

    // Servicios
    NotificacionService,
    NotificacionesQueryService,

    // Event Listeners
    PedidoStatusNotificacionListener,
    CobroVencidoNotificacionListener,
    NotaVentaNotificacionListener,

    // Cron Jobs
    CobrosVencimientoCron,
  ],
  exports: [NotificacionService, NotificacionesQueryService],
})
export class NotificacionesModule {}
