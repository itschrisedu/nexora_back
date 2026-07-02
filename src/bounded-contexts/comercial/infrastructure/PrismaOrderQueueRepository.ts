import { Injectable, Logger } from '@nestjs/common';
import { IOrderQueueRepository, OrderQueueEntry } from '../domain/IOrderQueueRepository';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';

@Injectable()
export class PrismaOrderQueueRepository extends IOrderQueueRepository {
  private readonly logger = new Logger(PrismaOrderQueueRepository.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findActiveByOrderId(orderId: string): Promise<OrderQueueEntry | null> {
    const record = await this.prisma.orderQueue.findFirst({
      where: { orderId, activa: true },
    });

    if (!record) return null;
    return this.toEntry(record);
  }

  async findActiveOrderByPriority(): Promise<OrderQueueEntry[]> {
    const records = await this.prisma.orderQueue.findMany({
      where: { activa: true },
      orderBy: [
        { prioridadFifo: 'asc' },
        { nivelCredito: 'desc' },
        { totalHistorico: 'desc' },
      ],
    });

    return records.map((r) => this.toEntry(r));
  }

  async findActiveByProduct(productId: string, tallaId: string): Promise<OrderQueueEntry[]> {
    const records = await this.prisma.orderQueue.findMany({
      where: {
        activa: true,
        order: {
          lines: {
            some: {
              productId,
              tallaId,
            },
          },
        },
      },
      orderBy: [
        { prioridadFifo: 'asc' },
        { nivelCredito: 'desc' },
        { totalHistorico: 'desc' },
      ],
    });

    return records.map((r) => this.toEntry(r));
  }

  async save(entry: Omit<OrderQueueEntry, 'id' | 'createdAt' | 'activadaAt'>): Promise<string> {
    const created = await this.prisma.orderQueue.create({
      data: {
        orderId: entry.orderId,
        clientId: entry.clientId,
        prioridadFifo: entry.prioridadFifo,
        nivelCredito: entry.nivelCredito,
        totalHistorico: entry.totalHistorico,
        activa: entry.activa,
      },
    });

    this.logger.log(`Pedido agregado a cola de prioridad: ${entry.orderId}`);
    return created.id;
  }

  async deactivate(id: string): Promise<void> {
    await this.prisma.orderQueue.update({
      where: { id },
      data: {
        activa: false,
        activadaAt: new Date(),
      },
    });

    this.logger.log(`Entrada de cola de prioridad desactivada: ${id}`);
  }

  // ── Mapeador interno ─────────────────────────

  private toEntry(record: any): OrderQueueEntry {
    return {
      id: record.id,
      orderId: record.orderId,
      clientId: record.clientId,
      prioridadFifo: record.prioridadFifo,
      nivelCredito: record.nivelCredito,
      totalHistorico: Number(record.totalHistorico),
      activa: record.activa,
      activadaAt: record.activadaAt,
      createdAt: record.createdAt,
    };
  }
}
