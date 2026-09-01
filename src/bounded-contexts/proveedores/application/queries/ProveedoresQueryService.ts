import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';

@Injectable()
export class ProveedoresQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async obtenerProveedor(id: string) {
    const raw = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        orders: true,
        entries: true,
        payments: true,
      },
    });
    if (!raw) {
      throw new NotFoundException(`Proveedor con ID "${id}" no encontrado.`);
    }

    const totalFacturado = raw.entries.reduce((acc, e) => acc + Number(e.total), 0);
    const totalPagado = raw.payments.reduce((acc, p) => acc + Number(p.monto), 0);
    const saldoPendiente = Math.max(0, totalFacturado - totalPagado);

    return {
      ...this.formatSupplier(raw),
      totalFacturado,
      totalPagado,
      saldoPendiente,
      totalOrdenes: raw.orders.length,
      totalEntregas: raw.entries.length,
    };
  }

  async buscarProveedores(tenantId?: string | null, q?: string) {
    const where: any = {};
    if (tenantId) {
      where.tenantId = tenantId;
    }
    const suppliers = await this.prisma.supplier.findMany({
      where,
      include: {
        orders: { select: { id: true, estado: true, total: true } },
        entries: { select: { id: true, total: true } },
        payments: { select: { id: true, monto: true } },
      },
      orderBy: { razonSocial: 'asc' },
    });

    const formated = suppliers.map((s) => {
      const base = this.formatSupplier(s);
      const totalCompras = s.entries.reduce((acc, e) => acc + Number(e.total), 0);
      const totalPagado = s.payments.reduce((acc, p) => acc + Number(p.monto), 0);
      const saldoPendiente = Math.max(0, totalCompras - totalPagado);
      const ordenesPendientes = s.orders.filter((o) => o.estado === 'PENDIENTE' || o.estado === 'BORRADOR').length;

      return {
        ...base,
        totalCompras,
        totalPagado,
        saldoPendiente,
        ordenesPendientes,
        totalOrdenes: s.orders.length,
        totalEntregas: s.entries.length,
      };
    });

    if (q) {
      const normalizedQuery = q.toLowerCase();
      return formated.filter(
        (s) =>
          s.razonSocial.toLowerCase().includes(normalizedQuery) ||
          s.ruc.includes(normalizedQuery) ||
          (s.contacto && s.contacto.toLowerCase().includes(normalizedQuery)),
      );
    }

    return formated;
  }

  async obtenerCuentaCorriente(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        orders: {
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        },
        entries: {
          include: { lines: true },
          orderBy: { fechaIngreso: 'desc' },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID "${supplierId}" no encontrado.`);
    }

    const totalFacturado = supplier.entries.reduce((acc, e) => acc + Number(e.total), 0);
    const totalPagado = supplier.payments.reduce((acc, p) => acc + Number(p.monto), 0);
    const saldoPendiente = Math.max(0, totalFacturado - totalPagado);

    // Build timeline movements
    const movimientos: any[] = [];

    supplier.entries.forEach((e) => {
      movimientos.push({
        id: e.id,
        tipo: 'ENTREGA_MERCANCIA',
        titulo: `Recepción Mercancía #ENT-${String(e.numero).padStart(4, '0')}`,
        numeroCodigo: `ENT-${String(e.numero).padStart(4, '0')}`,
        descripcion: e.observaciones || `Ingreso de ${e.lines.length} ítem(s) a bodega`,
        monto: Number(e.total),
        estado: e.estado,
        fecha: e.fechaIngreso.toISOString(),
        detalles: {
          lineas: e.lines.length,
          supplierOrderId: e.supplierOrderId,
        },
      });
    });

    supplier.payments.forEach((p) => {
      movimientos.push({
        id: p.id,
        tipo: 'PAGO_PROVEEDOR',
        titulo: `Pago Realizado (${p.metodo})`,
        numeroCodigo: p.comprobante ? `Comp: ${p.comprobante}` : undefined,
        descripcion: p.notas || (p.banco ? `Banco: ${p.banco}` : `Abono a proveedor`),
        monto: Number(p.monto),
        metodo: p.metodo,
        banco: p.banco,
        comprobante: p.comprobante,
        fecha: p.createdAt.toISOString(),
      });
    });

    supplier.orders.forEach((o) => {
      movimientos.push({
        id: o.id,
        tipo: 'ORDEN_COMPRA',
        titulo: `Orden de Compra #OC-${String(o.numero).padStart(4, '0')}`,
        numeroCodigo: `OC-${String(o.numero).padStart(4, '0')}`,
        descripcion: o.observaciones || `${o.lines.length} producto(s) pedidos`,
        monto: Number(o.total),
        estado: o.estado,
        fecha: o.createdAt.toISOString(),
      });
    });

    // Ordenar cronológicamente descendente
    movimientos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    return {
      supplier: this.formatSupplier(supplier),
      resumen: {
        totalFacturado,
        totalPagado,
        saldoPendiente,
        totalOrdenes: supplier.orders.length,
        totalEntregas: supplier.entries.length,
        totalPagos: supplier.payments.length,
      },
      movimientos,
      ordenes: supplier.orders.map((o) => ({
        ...o,
        total: Number(o.total),
      })),
      entradas: supplier.entries.map((e) => ({
        ...e,
        total: Number(e.total),
      })),
      pagos: supplier.payments.map((p) => ({
        ...p,
        monto: Number(p.monto),
      })),
    };
  }

  async obtenerOrdenCompra(id: string) {
    const order = await this.prisma.supplierOrder.findUnique({
      where: { id },
      include: {
        lines: true,
        supplier: true,
        entry: {
          select: { id: true, numero: true, fechaIngreso: true, estado: true },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Orden de compra "${id}" no encontrada.`);
    }

    // Populate products metadata
    const productIds = order.lines.map((l) => l.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        model: true,
        serie: true,
      },
    });

    const productMap = new Map<string, any>();
    products.forEach((p) => productMap.set(p.id, p));

    return {
      ...order,
      supplier: this.formatSupplier(order.supplier),
      total: Number(order.total),
      lines: order.lines.map((l) => {
        const prod = productMap.get(l.productId);
        return {
          ...l,
          precioCosto: Number(l.precioCosto),
          subtotal: Number(l.subtotal),
          producto: prod ? {
            id: prod.id,
            codigo: prod.code,
            color: prod.color,
            imageUrl: prod.imageUrl,
            nombre: prod.model ? `${prod.model.brand} ${prod.model.name}` : prod.code,
            marca: prod.model?.brand,
            serie: prod.serie?.name,
          } : undefined,
        };
      }),
    };
  }

  async listarOrdenesCompra(supplierId?: string, tenantId?: string | null) {
    const where: any = {};
    if (supplierId) {
      where.supplierId = supplierId;
    }
    if (tenantId) {
      where.supplier = { tenantId };
    }
    const orders = await this.prisma.supplierOrder.findMany({
      where,
      include: {
        supplier: true,
        lines: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Populate product thumbnails
    const allProductIds = Array.from(new Set(orders.flatMap((o) => o.lines.map((l) => l.productId))));
    const products = await this.prisma.product.findMany({
      where: { id: { in: allProductIds } },
      include: { model: true },
    });
    const productMap = new Map<string, any>();
    products.forEach((p) => productMap.set(p.id, p));

    return orders.map((o) => ({
      ...o,
      supplier: this.formatSupplier(o.supplier),
      total: Number(o.total),
      totalLineas: o.lines.length,
      lines: o.lines.map((l) => {
        const prod = productMap.get(l.productId);
        return {
          ...l,
          precioCosto: Number(l.precioCosto),
          subtotal: Number(l.subtotal),
          producto: prod ? {
            id: prod.id,
            codigo: prod.code,
            imageUrl: prod.imageUrl,
            nombre: prod.model ? `${prod.model.brand} ${prod.model.name}` : prod.code,
          } : undefined,
        };
      }),
    }));
  }

  async obtenerEntradaMercancia(id: string) {
    const entry = await this.prisma.merchandiseEntry.findUnique({
      where: { id },
      include: {
        lines: true,
        supplier: true,
        supplierOrder: {
          select: { id: true, numero: true, total: true, estado: true, observaciones: true },
        },
      },
    });
    if (!entry) {
      throw new NotFoundException(`Entrada de mercancía "${id}" no encontrada.`);
    }

    const productIds = entry.lines.map((l) => l.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { model: true, serie: true },
    });
    const productMap = new Map<string, any>();
    products.forEach((p) => productMap.set(p.id, p));

    return {
      ...entry,
      supplier: this.formatSupplier(entry.supplier),
      total: Number(entry.total),
      supplierOrder: entry.supplierOrder ? {
        ...entry.supplierOrder,
        total: Number(entry.supplierOrder.total),
      } : null,
      lines: entry.lines.map((l) => {
        const prod = productMap.get(l.productId);
        return {
          ...l,
          precioCosto: Number(l.precioCosto),
          subtotal: Number(l.subtotal),
          producto: prod ? {
            id: prod.id,
            codigo: prod.code,
            imageUrl: prod.imageUrl,
            nombre: prod.model ? `${prod.model.brand} ${prod.model.name}` : prod.code,
          } : undefined,
        };
      }),
    };
  }

  async listarEntradasMercancia(supplierId?: string, tenantId?: string | null) {
    const where: any = {};
    if (supplierId) {
      where.supplierId = supplierId;
    }
    if (tenantId) {
      where.supplier = { tenantId };
    }
    const entries = await this.prisma.merchandiseEntry.findMany({
      where,
      include: {
        supplier: true,
        lines: true,
        supplierOrder: {
          select: { id: true, numero: true },
        },
      },
      orderBy: { fechaIngreso: 'desc' },
    });
    return entries.map((e) => ({
      ...e,
      supplier: this.formatSupplier(e.supplier),
      total: Number(e.total),
      totalLineas: e.lines.length,
    }));
  }

  async listarTodosPagos(tenantId?: string | null) {
    const where: any = {};
    if (tenantId) {
      where.supplier = { tenantId };
    }
    const payments = await this.prisma.supplierPayment.findMany({
      where,
      include: {
        supplier: true,
        supplierOrder: {
          select: { id: true, numero: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => ({
      ...p,
      monto: Number(p.monto),
      supplier: this.formatSupplier(p.supplier),
    }));
  }

  private formatSupplier(raw: any) {
    let rucDescifrado = raw.ruc;
    try {
      rucDescifrado = this.encryptionService.decrypt(raw.ruc);
    } catch (e) {
      // Fallback
    }
    return {
      id: raw.id,
      ruc: rucDescifrado,
      razonSocial: raw.razonSocial,
      nombre: raw.razonSocial, // Alias for UI consistency
      contacto: raw.contacto,
      direccion: raw.direccion,
      email: raw.email,
      activo: raw.activo,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
