import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { LiberarReservaHandler } from '../../application/commands/LiberarReserva.handler';
import { LiberarReservaCommand } from '../../application/commands/LiberarReserva.command';

/**
 * LimpiarReservasExpiradas — Cron Job.
 * Se ejecuta cada 5 minutos y libera todas las reservas de stock
 * cuyo tiempo límite (expiresAt) haya expirado.
 */
@Injectable()
export class LimpiarReservasExpiradas {
  private readonly logger = new Logger(LimpiarReservasExpiradas.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly liberarReservaHandler: LiberarReservaHandler,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    const reservasExpiradas = await this.prisma.stockReservation.findMany({
      where: {
        canceled: false,
        expiresAt: { lt: new Date() },
      },
    });

    if (reservasExpiradas.length === 0) return;

    this.logger.log(
      `🧹 Encontradas ${reservasExpiradas.length} reserva(s) expirada(s). Liberando...`,
    );

    for (const reserva of reservasExpiradas) {
      try {
        await this.liberarReservaHandler.execute(
          new LiberarReservaCommand(reserva.id),
        );
        this.logger.log(`  ✅ Reserva ${reserva.id} liberada`);
      } catch (error) {
        this.logger.error(
          `  ❌ Error liberando reserva ${reserva.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
