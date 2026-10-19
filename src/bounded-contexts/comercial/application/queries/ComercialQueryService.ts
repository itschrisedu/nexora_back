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
        tenant: { select: { id: true, name: true } },
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
      include: { lines: true, queueEntry: true, tenant: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return this.attachClientNames(orders);
  }

  async obtenerTodosLosPedidos(tenantId?: string | null) {
    const where: any = {};
    if (tenantId) {
      where.tenantId = tenantId;
    }

    // Auto-evaluar pedidos en EN_ESPERA_STOCK y PENDIENTE según stock físico real
    try {
      // 1. Si tienen stock suficiente para todas sus líneas, promover EN_ESPERA_STOCK a EN_PREPARACION o PENDIENTE
      const enEspera = await this.prisma.order.findMany({
        where: {
          ...where,
          estado: PrismaEstadoPedido.EN_ESPERA_STOCK,
        },
        include: { lines: true },
      });

      for (const ped of enEspera) {
        let tieneStockCompleto = true;
        for (const line of ped.lines) {
          const stock = await this.prisma.stockByTalla.findUnique({
            where: {
              productId_tallaId: {
                productId: line.productId,
                tallaId: line.tallaId,
              },
            },
          });
          const disp = stock ? (stock.quantity - stock.reservedQuantity) : 0;
          if (disp < line.cantidad) {
            tieneStockCompleto = false;
            break;
          }
        }
        if (tieneStockCompleto && ped.lines.length > 0) {
          await this.prisma.order.update({
            where: { id: ped.id },
            data: { estado: PrismaEstadoPedido.PENDIENTE },
          });
          await this.prisma.orderQueue.updateMany({
            where: { orderId: ped.id, activa: true },
            data: { activa: false, activadaAt: new Date() },
          });
        }
      }

      // 2. Si un pedido en PENDIENTE no tiene stock suficiente para sus líneas, pasarlo a EN_ESPERA_STOCK
      const pendientes = await this.prisma.order.findMany({
        where: {
          ...where,
          estado: PrismaEstadoPedido.PENDIENTE,
        },
        include: { lines: true },
      });

      for (const ped of pendientes) {
        let faltaStock = false;
        for (const line of ped.lines) {
          const stock = await this.prisma.stockByTalla.findUnique({
            where: {
              productId_tallaId: {
                productId: line.productId,
                tallaId: line.tallaId,
              },
            },
          });
          const disp = stock ? (stock.quantity - stock.reservedQuantity) : 0;
          if (disp < line.cantidad) {
            faltaStock = true;
            break;
          }
        }
        if (faltaStock) {
          await this.prisma.order.update({
            where: { id: ped.id },
            data: { estado: PrismaEstadoPedido.EN_ESPERA_STOCK },
          });
        }
      }
    } catch (e) {
      // Ignorar si falla auto-sync
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: { lines: true, queueEntry: true, tenant: { select: { id: true, name: true } } },
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
      include: { lines: true, queueEntry: true, tenant: { select: { id: true, name: true } } },
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
    const userIds = Array.from(new Set(orders.map((o) => o.userId).filter(Boolean)));
    const clientMap = new Map<string, string>();
    const userMap = new Map<string, string>();

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

    const userTenantMap = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds as string[] } },
        select: { id: true, nombre: true, email: true, tenantId: true },
      });
      users.forEach((u) => {
        userMap.set(u.id, u.nombre || u.email || 'Vendedor');
        if (u.tenantId) userTenantMap.set(u.id, u.tenantId);
      });
    }

    // Collect productIds, tallaIds and serieIds from all lines
    const allLines = orders.flatMap((o) => o.lines || []);
    const productIds = Array.from(new Set(allLines.map((l: any) => l.productId).filter(Boolean)));
    const tallaIds = Array.from(new Set(allLines.map((l: any) => l.tallaId).filter(Boolean)));
    const serieIds = Array.from(new Set(allLines.map((l: any) => l.serieId).filter(Boolean)));

    const productMap = new Map<string, any>();
    const tallaMap = new Map<string, number>();
    const serieMap = new Map<string, string>();

    if (productIds.length > 0) {
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds as string[] } },
        include: { model: true, serie: true, stockByTalla: true },
      });
      products.forEach((p) => {
        productMap.set(p.id, p);
        if (p.serieId && p.serie?.nombre) {
          serieMap.set(p.serieId, p.serie.nombre);
        }
      });
    }

    if (tallaIds.length > 0) {
      const tallas = await this.prisma.tallaConfig.findMany({
        where: { id: { in: tallaIds as string[] } },
      });
      tallas.forEach((t) => tallaMap.set(t.id, t.numero));
    }

    const missingSerieIds = serieIds.filter((id) => !serieMap.has(id));
    if (missingSerieIds.length > 0) {
      const series = await this.prisma.seriesConfig.findMany({
        where: { id: { in: missingSerieIds as string[] } },
      });
      series.forEach((s) => serieMap.set(s.id, s.nombre));
    }

    // Resolver sucursales (tenants) tanto de destino (tenantId de la orden) como de origen (tenantId del usuario creador)
    const allTenantIds = Array.from(
      new Set(
        [
          ...orders.map((o) => o.tenantId),
          ...Array.from(userTenantMap.values()),
        ].filter(Boolean) as string[],
      ),
    );
    const tenantNameMap = new Map<string, string>();
    if (allTenantIds.length > 0) {
      const tenants = await this.prisma.tenant.findMany({
        where: { id: { in: allTenantIds } },
        select: { id: true, name: true },
      });
      tenants.forEach((t) => tenantNameMap.set(t.id, t.name));
    }

    // Cargar devoluciones asociadas a los pedidos
    const orderIds = orders.map((o) => o.id);
    const devoluciones = orderIds.length > 0
      ? await this.prisma.clienteDevolucion.findMany({
          where: { orderId: { in: orderIds } },
          include: { lines: true },
        })
      : [];

    const devolucionesByOrder = new Map<string, any[]>();
    devoluciones.forEach((d) => {
      if (!d.orderId) return;
      const list = devolucionesByOrder.get(d.orderId) || [];
      list.push(d);
      devolucionesByOrder.set(d.orderId, list);
    });

    // Calcular numeración correlativa cronológica (PED-0001, PED-0002, ...)
    const sortedChronologically = [...orders].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const orderNumberMap = new Map<string, string>();
    sortedChronologically.forEach((o, index) => {
      orderNumberMap.set(o.id, `PED-${String(index + 1).padStart(4, '0')}`);
    });

    return orders.map((o) => {
      const orderDevs = devolucionesByOrder.get(o.id) || [];
      const formatted = this.formatPedido(o, productMap, tallaMap, serieMap, orderNumberMap.get(o.id), orderDevs);
      const creadoPorSucursalId = userTenantMap.get(o.userId) || o.tenantId;
      const creadoPorSucursalNombre = tenantNameMap.get(creadoPorSucursalId) || o.tenant?.name || '';
      const sucursalNombre = o.tenant?.name || tenantNameMap.get(o.tenantId) || 'Sucursal';

      return {
        ...formatted,
        tenantId: o.tenantId,
        sucursalId: o.tenantId,
        creadoPorSucursalId,
        creadoPorSucursalNombre,
        clienteNombre: clientMap.get(o.clientId) || 'Consumidor Final',
        vendedorNombre: userMap.get(o.userId) || 'Vendedor',
        sucursalNombre,
      };
    });
  }

  private formatPedido(
    record: any,
    productMap?: Map<string, any>,
    tallaMap?: Map<string, number>,
    serieMap?: Map<string, string>,
    numeroCodigo?: string,
    orderDevoluciones: any[] = [],
  ) {
    const totalParesDevueltos = orderDevoluciones.reduce(
      (acc, dev) => acc + (dev.lines || []).reduce((s: number, dl: any) => s + dl.cantidad, 0),
      0,
    );
    const totalMontoDevuelto = orderDevoluciones.reduce(
      (acc, dev) => acc + Number(dev.totalDevuelto || 0),
      0,
    );

    return {
      id: record.id,
      tenantId: record.tenantId,
      sucursalId: record.tenantId,
      numeroCodigo: numeroCodigo || `PED-${record.id.slice(0, 4).toUpperCase()}`,
      clientId: record.clientId,
      estado: record.estado,
      canal: record.canal,
      tipoPago: record.tipoPago,
      montoTotal: Number(record.montoTotal),
      notas: record.notas,
      userId: record.userId,
      tipoEntrega: record.tipoEntrega || 'PRESENCIAL',
      asumeFlete: record.asumeFlete || 'NO_APLICA',
      costoEnvio: record.costoEnvio ? Number(record.costoEnvio) : 0,
      guiaEnvio: record.guiaEnvio || null,
      courier: record.courier || null,
      direccionEnvio: record.direccionEnvio || null,
      ciudadEnvio: record.ciudadEnvio || null,
      adelanto: record.adelanto ? Number(record.adelanto) : 0,
      metodoAdelanto: record.metodoAdelanto || null,
      referenciaAdelanto: record.referenciaAdelanto || null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      devolucionesCount: orderDevoluciones.length,
      totalParesDevueltos,
      totalMontoDevuelto,
      devoluciones: orderDevoluciones.map((d) => ({
        id: d.id,
        motivo: d.motivo,
        totalDevuelto: Number(d.totalDevuelto),
        estado: d.estado,
        destinoStock: d.destinoStock,
        deudaDescontada: Number(d.deudaDescontada || 0),
        saldoAFavor: Number(d.saldoAFavor || 0),
        createdAt: d.createdAt,
        lines: (d.lines || []).map((dl: any) => ({
          id: dl.id,
          productId: dl.productId,
          tallaId: dl.tallaId,
          cantidad: dl.cantidad,
          precioUnitario: Number(dl.precioUnitario),
          subtotal: Number(dl.subtotal),
        })),
      })),
      lines: record.lines?.map((l: any) => {
        const prod = productMap?.get(l.productId);
        const numeroTalla = tallaMap?.get(l.tallaId) ?? l.numeroTalla;
        const stockTalla = prod?.stockByTalla?.find((s: any) => s.tallaId === l.tallaId);
        const stockFisico = stockTalla ? stockTalla.quantity : 0;
        const stockDisponible = stockFisico;
        const cantidadEntregada = l.cantidadEntregada || 0;
        const cantidadPendiente = Math.max(0, l.cantidad - cantidadEntregada);
        const serieResuelta = (l.serieId ? serieMap?.get(l.serieId) : null) || prod?.serie?.nombre || (prod?.serieId ? serieMap?.get(prod.serieId) : null) || l.serieNombre || 'Estándar';

        // Calcular cuántos pares de esta línea específica ya fueron devueltos
        const cantidadDevuelta = orderDevoluciones.reduce((acc, dev) => {
          const match = (dev.lines || []).filter((dl: any) => dl.productId === l.productId && dl.tallaId === l.tallaId);
          return acc + match.reduce((s: number, dl: any) => s + dl.cantidad, 0);
        }, 0);

        const disponibleParaDevolver = Math.max(0, cantidadEntregada - cantidadDevuelta);

        return {
          id: l.id,
          productId: l.productId,
          serieId: l.serieId,
          tallaId: l.tallaId,
          cantidad: l.cantidad,
          cantidadEntregada,
          cantidadPendiente,
          cantidadDevuelta,
          disponibleParaDevolver,
          stockDisponible,
          stockFisico,
          precioUnitario: Number(l.precioUnitario),
          subtotal: l.cantidad * Number(l.precioUnitario),
          tipoVenta: l.tipoVenta,
          modelId: prod?.modelId || prod?.model?.id || l.modelId || null,
          modelName: prod?.model?.name || l.modelName || 'Calzado',
          color: prod?.color || l.color || '',
          imageUrl: prod?.imageUrl || l.imageUrl || null,
          serieNombre: serieResuelta,
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
