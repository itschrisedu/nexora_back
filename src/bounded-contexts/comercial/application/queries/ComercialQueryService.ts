import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EstadoPedido as PrismaEstadoPedido } from '@prisma/client';

@Injectable()
export class ComercialQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerPedido(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            order: true,
          },
        },
        queueEntry: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Pedido con ID "${id}" no encontrado`);
    }

    return this.formatPedido(order);
  }

  async obtenerPedidosPorEstado(estado: PrismaEstadoPedido) {
    const orders = await this.prisma.order.findMany({
      where: { estado },
      include: { lines: true, queueEntry: true },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((o) => this.formatPedido(o));
  }

  async obtenerPedidosPorCliente(clientId: string) {
    const orders = await this.prisma.order.findMany({
      where: { clientId },
      include: { lines: true, queueEntry: true },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((o) => this.formatPedido(o));
  }

  async obtenerPedidosEnCola() {
    const queue = await this.prisma.orderQueue.findMany({
      where: { activa: true },
      orderBy: [
        { prioridadFifo: 'asc' },      // Criterio 1: Primero en pedir (FIFO)
        { nivelCredito: 'desc' },      // Criterio 2: Mayor nivel crediticio
        { totalHistorico: 'desc' },    // Criterio 3: Mayor volumen de compras históricas
      ],
      include: {
        order: {
          include: { lines: true },
        },
      },
    });

    return queue.map((q) => ({
      queueId: q.id,
      prioridadFifo: q.prioridadFifo,
      nivelCredito: q.nivelCredito,
      totalHistorico: Number(q.totalHistorico),
      order: this.formatPedido(q.order),
    }));
  }

  // ── Mapeador interno ─────────────────────────

  private formatPedido(record: any) {
    return {
      id: record.id,
      clientId: record.clientId,
      estado: record.estado,
      canal: record.canal,
      tipoPago: record.tipoPago,
      montoTotal: Number(record.montoTotal),
      notas: record.notas,
      userId: record.userId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lines: record.lines?.map((l: any) => ({
        id: l.id,
        productId: l.productId,
        serieId: l.serieId,
        tallaId: l.tallaId,
        cantidad: l.cantidad,
        precioUnitario: Number(l.precioUnitario),
        subtotal: l.cantidad * Number(l.precioUnitario),
        tipoVenta: l.tipoVenta,
      })),
      cola: record.queueEntry
        ? {
            id: record.queueEntry.id,
            activa: record.queueEntry.activa,
            prioridadFifo: record.queueEntry.prioridadFifo,
          }
        : null,
    };
  }
}
