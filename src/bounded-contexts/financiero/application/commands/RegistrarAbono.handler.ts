import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ICobroRepository } from '../../domain/ICobroRepository';
import { Money } from '../../../../shared/domain/Money';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { TipoCobro } from '@prisma/client';

@Injectable()
export class RegistrarAbonoHandler {
  constructor(
    @Inject('ICobroRepository') private readonly cobroRepo: ICobroRepository,
    private readonly eventBus: EventBus,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: {
    cobroId: string;
    monto: number;
    metodo: string;
    userId: string;
    notas?: string;
  }): Promise<{ reclasificadoAContado: boolean }> {
    const cobro = await this.cobroRepo.findById(command.cobroId);
    if (!cobro) {
      throw new NotFoundException(`Cobro ${command.cobroId} no encontrado`);
    }

    const abonoId = crypto.randomUUID();
    let notasFinal = command.notas;
    let esProntoPago24h = false;

    // Verificar si el cobro se salda al 100% y califica para Pronto Pago (<= 24h desde creación)
    const saldoRestante = cobro.saldoPendiente.amount - command.monto;
    if (saldoRestante <= 0 && cobro.tipo === TipoCobro.CREDITO) {
      const diffHoras = (Date.now() - new Date(cobro.createdAt).getTime()) / (1000 * 60 * 60);
      if (diffHoras <= 24) {
        esProntoPago24h = true;
        cobro.reclasificarAContado();
        const tag = '[PRONTO PAGO 24H: RECLASIFICADO A CONTADO]';
        notasFinal = notasFinal ? `${tag} ${notasFinal.trim()}` : `${tag} Liquidación total en 24h`;
      }
    }

    cobro.registrarAbono(
      abonoId,
      Money.create(command.monto),
      command.metodo,
      command.userId,
      notasFinal,
    );

    await this.cobroRepo.update(cobro);

    // Si fue reclasificado a CONTADO, sincronizar la orden de pedido origen
    if (esProntoPago24h && cobro.saleNoteId) {
      try {
        const saleNote = await this.prisma.saleNote.findUnique({
          where: { id: cobro.saleNoteId },
          select: { orderId: true },
        });
        if (saleNote?.orderId) {
          const orderActual = await this.prisma.order.findUnique({
            where: { id: saleNote.orderId },
            select: { notas: true },
          });
          const auditTag = '[Pronto Pago 24h: Reclasificado automáticamente a CONTADO]';
          const notasActualizadas = orderActual?.notas
            ? `${orderActual.notas.trim()} | ${auditTag}`
            : auditTag;
          await this.prisma.order.update({
            where: { id: saleNote.orderId },
            data: {
              tipoPago: 'CONTADO',
              notas: notasActualizadas,
            },
          });
        }
      } catch (errOrder) {
        // Continuar sin romper el flujo
      }
    }

    // Publicar eventos de dominio (AbonoRegistrado, DeudaSaldada si aplica)
    this.eventBus.publishAll(cobro.clearDomainEvents());

    return { reclasificadoAContado: esProntoPago24h };
  }
}
