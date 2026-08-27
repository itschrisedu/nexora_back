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

    const [formatted] = await this.attachClientNames([order]);
    return formatted;
  }

  async obtenerPedidosPorEstado(estado: PrismaEstadoPedido, tenantId?: string | null) {
    const where: any = { estado };
    if (tenantId) {
      where.tenantId = tenantId;
    }
    const orders = await this.prisma.order.findMany({
      where,
      include: { lines: true, queueEntry: true },
      orderBy: { createdAt: 'desc' },
    });

    return this.attachClientNames(orders);
  }

  async obtenerTodosLosPedidos(tenantId?: string | null) {
    const where: any = {};
    if (tenantId) {
      where.tenantId = tenantId;
    }
    const orders = await this.prisma.order.findMany({
      where,
      include: { lines: true, queueEntry: true },
      orderBy: { createdAt: 'desc' },
    });

    return this.attachClientNames(orders);
  }

  async obtenerPedidosPorCliente(clientId: string, tenantId?: string | null) {
    const where: any = { clientId };
    if (tenantId) {
      where.tenantId = tenantId;
    }
    const orders = await this.prisma.order.findMany({
      where,
      include: { lines: true, queueEntry: true },
      orderBy: { createdAt: 'desc' },
    });

    return this.attachClientNames(orders);
  }

  async obtenerPedidosEnCola(tenantId?: string | null) {
    const where: any = { activa: true };
    if (tenantId) {
      where.order = { tenantId };
    }
    const queue = await this.prisma.orderQueue.findMany({
      where,
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

    const orders = await this.attachClientNames(queue.map((q) => q.order));
    const orderMap = new Map(orders.map((o) => [o.id, o]));

    return queue.map((q) => ({
      queueId: q.id,
      prioridadFifo: q.prioridadFifo,
      nivelCredito: q.nivelCredito,
      totalHistorico: Number(q.totalHistorico),
      order: orderMap.get(q.order.id) || this.formatPedido(q.order),
    }));
  }

  // ── Mapeador interno ─────────────────────────

  private async attachClientNames(orders: any[]) {
    const clientIds = Array.from(new Set(orders.map((o) => o.clientId).filter(Boolean)));
    const clientMap = new Map<string, string>();

    if (clientIds.length > 0) {
      const clients = await this.prisma.client.findMany({
        where: { id: { in: clientIds as string[] } },
        select: { id: true, nombre: true, apellido: true },
      });
      clients.forEach((c) => {
        const full = `${c.nombre || ''} ${c.apellido || ''}`.trim();
        clientMap.set(c.id, full || 'Consumidor Final');
      });
    }

    // Collect productIds and tallaIds from all lines
    const allLines = orders.flatMap((o) => o.lines || []);
    const productIds = Array.from(new Set(allLines.map((l: any) => l.productId).filter(Boolean)));
    const tallaIds = Array.from(new Set(allLines.map((l: any) => l.tallaId).filter(Boolean)));

    const productMap = new Map<string, any>();
    const tallaMap = new Map<string, number>();

    if (productIds.length > 0) {
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds as string[] } },
        include: { model: true, serie: true },
      });
      products.forEach((p) => productMap.set(p.id, p));
    }

    if (tallaIds.length > 0) {
      const tallas = await this.prisma.tallaConfig.findMany({
        where: { id: { in: tallaIds as string[] } },
      });
      tallas.forEach((t) => tallaMap.set(t.id, t.numero));
    }

    // Calcular numeración correlativa cronológica (PED-0001, PED-0002, ...)
    const sortedChronologically = [...orders].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const orderNumberMap = new Map<string, string>();
    sortedChronologically.forEach((o, index) => {
      orderNumberMap.set(o.id, `PED-${String(index + 1).padStart(4, '0')}`);
    });

    return orders.map((o) => {
      const formatted = this.formatPedido(o, productMap, tallaMap, orderNumberMap.get(o.id));
      return {
        ...formatted,
        clienteNombre: clientMap.get(o.clientId) || 'Consumidor Final',
      };
    });
  }

  private formatPedido(
    record: any,
    productMap?: Map<string, any>,
    tallaMap?: Map<string, number>,
    numeroCodigo?: string,
  ) {
    return {
      id: record.id,
      numeroCodigo: numeroCodigo || `PED-${record.id.slice(0, 4).toUpperCase()}`,
      clientId: record.clientId,
      estado: record.estado,
      canal: record.canal,
      tipoPago: record.tipoPago,
      montoTotal: Number(record.montoTotal),
      notas: record.notas,
      userId: record.userId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lines: record.lines?.map((l: any) => {
        const prod = productMap?.get(l.productId);
        const numeroTalla = tallaMap?.get(l.tallaId) ?? l.numeroTalla;
        return {
          id: l.id,
          productId: l.productId,
          serieId: l.serieId,
          tallaId: l.tallaId,
          cantidad: l.cantidad,
          precioUnitario: Number(l.precioUnitario),
          subtotal: l.cantidad * Number(l.precioUnitario),
          tipoVenta: l.tipoVenta,
          modelName: prod?.model?.name || l.modelName || 'Calzado',
          color: prod?.color || l.color || '',
          imageUrl: prod?.imageUrl || l.imageUrl || null,
          serieNombre: prod?.serie?.nombre || l.serieNombre || 'Estándar',
          numeroTalla: numeroTalla ?? 0,
        };
      }),
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
