import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';
import { VencimientoCobroEvent, CobroVencidoSinPagoEvent } from '../../../financiero/domain/events/FinancieroEvents';

/**
 * Cron Job que se ejecuta diariamente a las 8 AM.
 * - Detecta cobros a crédito próximos a vencer (48h) y emite VencimientoCobroEvent.
 * - Detecta cobros ya vencidos sin pago y emite CobroVencidoSinPagoEvent.
 */
@Injectable()
export class CobrosVencimientoCron {
  private readonly logger = new Logger(CobrosVencimientoCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  @Cron('0 8 * * *', { name: 'cobros-vencimiento-check' })
  async handleCobrosVencimiento(): Promise<void> {
    this.logger.log('⏰ Ejecutando revisión de cobros por vencer y vencidos...');

    const ahora = new Date();
    const en48Horas = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);

    // 1. Cobros próximos a vencer (en las próximas 48 horas)
    const proximosAVencer = await (this.prisma as any).cobro.findMany({
      where: {
        estado: { in: ['PENDIENTE', 'PARCIALMENTE_PAGADO'] },
        fechaVencimiento: {
          gte: ahora,
          lte: en48Horas,
        },
      },
      select: { id: true, clientId: true, saldoPendiente: true },
    });

    for (const cobro of proximosAVencer) {
      this.eventBus.publish(
        new VencimientoCobroEvent(
          cobro.id,
          cobro.clientId,
          Number(cobro.saldoPendiente),
        ),
      );
    }

    // 2. Cobros ya vencidos
    const vencidos = await (this.prisma as any).cobro.findMany({
      where: {
        estado: { in: ['PENDIENTE', 'PARCIALMENTE_PAGADO'] },
        fechaVencimiento: { lt: ahora },
      },
      select: { id: true, clientId: true, saldoPendiente: true, fechaVencimiento: true },
    });

    for (const cobro of vencidos) {
      const diasVencido = Math.floor(
        (ahora.getTime() - cobro.fechaVencimiento!.getTime()) / (1000 * 60 * 60 * 24),
      );

      this.eventBus.publish(
        new CobroVencidoSinPagoEvent(
          cobro.id,
          cobro.clientId,
          Number(cobro.saldoPendiente),
          diasVencido,
        ),
      );
    }

    this.logger.log(
      `📊 Resultados: ${proximosAVencer.length} próximos a vencer, ${vencidos.length} vencidos`,
    );
  }
}
