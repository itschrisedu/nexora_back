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
        tenant: { select: { id: true, name: true } },
        orders: true,
        entries: true,
        payments: true,
        devoluciones: true,
      },
    });
    if (!raw) {
      throw new NotFoundException(`Proveedor con ID "${id}" no encontrado.`);
    }

    const totalFacturado = raw.entries.reduce((acc, e) => acc + Number(e.total), 0);
    const totalPagado = raw.payments.reduce((acc, p) => acc + Number(p.monto), 0);
    const totalDevoluciones = raw.devoluciones ? raw.devoluciones.reduce((acc, d) => acc + Number(d.totalDevuelto), 0) : 0;
    const saldoPendiente = Math.max(0, totalFacturado - totalPagado - totalDevoluciones);

    return {
      ...this.formatSupplier(raw),
      totalFacturado,
      totalPagado,
      totalDevoluciones,
      saldoPendiente,
      totalOrdenes: raw.orders.length,
      totalEntregas: raw.entries.length,
      totalDevolucionesCount: raw.devoluciones ? raw.devoluciones.length : 0,
    };
  }

  private async getOrganizationTenantIds(tenantId: string): Promise<string[]> {
    if (!tenantId) return [];
    const mainTenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { businessConfig: true },
    });
    let plainRucMatriz = '';
    if (mainTenant?.businessConfig?.ruc) {
      try {
        plainRucMatriz = this.encryptionService.decrypt(mainTenant.businessConfig.ruc);
      } catch {}
    }

    const allTenants = await this.prisma.tenant.findMany({
      where: { active: true },
      include: {
        businessConfig: true,
        users: { select: { id: true, parentId: true } },
      },
    });

    const mainAdmin = await this.prisma.user.findFirst({
      where: { tenantId, rol: { in: ['ROL_ADMIN', 'ROL_SUPER_ADMIN'] as any } },
    });

    const userInBranch = await this.prisma.user.findFirst({
      where: { tenantId },
      include: { parent: true },
    });

    const matching = allTenants.filter((s) => {
      if (s.id === tenantId) return true;
      if (plainRucMatriz && s.businessConfig?.ruc) {
        try {
          if (this.encryptionService.decrypt(s.businessConfig.ruc) === plainRucMatriz) return true;
        } catch {}
      }
      if (mainAdmin && s.users.some((u) => u.parentId === mainAdmin.id || u.id === mainAdmin.id)) {
        return true;
      }
      if (userInBranch?.parentId && (s.users.some((u) => u.id === userInBranch.parentId || u.parentId === userInBranch.parentId))) {
        return true;
      }
      return false;
    });

    return matching.map((s) => s.id);
  }

  async buscarProveedores(tenantId?: string | null, q?: string) {
    if (!tenantId) {
      return [];
    }
    const targetTenantIds = await this.getOrganizationTenantIds(tenantId);
    const where: any = targetTenantIds.length > 0 ? { tenantId: { in: targetTenantIds } } : { tenantId };
    const suppliers = await this.prisma.supplier.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true } },
        orders: { select: { id: true, estado: true, total: true } },
        entries: { select: { id: true, total: true } },
        payments: { select: { id: true, monto: true } },
        devoluciones: { select: { id: true, totalDevuelto: true } },
      },
      orderBy: { razonSocial: 'asc' },
    });

    const formated = suppliers.map((s) => {
      const base = this.formatSupplier(s);
      const totalCompras = s.entries.reduce((acc, e) => acc + Number(e.total), 0);
      const totalPagado = s.payments.reduce((acc, p) => acc + Number(p.monto), 0);
      const totalDevoluciones = s.devoluciones ? s.devoluciones.reduce((acc, d) => acc + Number(d.totalDevuelto), 0) : 0;
      const saldoPendiente = Math.max(0, totalCompras - totalPagado - totalDevoluciones);
      const ordenesPendientes = s.orders.filter((o) => o.estado === 'PENDIENTE' || o.estado === 'BORRADOR').length;

      return {
        ...base,
        totalCompras,
        totalPagado,
        totalDevoluciones,
        saldoPendiente,
        ordenesPendientes,
        totalOrdenes: s.orders.length,
        totalEntregas: s.entries.length,
        totalDevolucionesCount: s.devoluciones ? s.devoluciones.length : 0,
      };
    });

    if (q && q.trim()) {
      const terminos = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
      return formated.filter((s) => {
        const razon = (s.razonSocial || '').toLowerCase();
        const ruc = (s.ruc || '').toLowerCase();
        const contacto = (s.contacto || '').toLowerCase();
        const direccion = (s.direccion || '').toLowerCase();
        const email = (s.email || '').toLowerCase();

        return terminos.every(
          (t) =>
            razon.includes(t) ||
            ruc.includes(t) ||
            contacto.includes(t) ||
            direccion.includes(t) ||
            email.includes(t),
        );
      });
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
        devoluciones: {
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID "${supplierId}" no encontrado.`);
    }

    const totalFacturado = supplier.entries.reduce((acc, e) => acc + Number(e.total), 0);
    const totalPagado = supplier.payments.reduce((acc, p) => acc + Number(p.monto), 0);
    const totalDevoluciones = supplier.devoluciones ? supplier.devoluciones.reduce((acc, d) => acc + Number(d.totalDevuelto), 0) : 0;
    const saldoPendiente = Math.max(0, totalFacturado - totalPagado - totalDevoluciones);

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

    supplier.devoluciones.forEach((d) => {
      movimientos.push({
        id: d.id,
        tipo: 'DEVOLUCION_PROVEEDOR',
        titulo: `Devolución de Mercadería #${d.numero ? `DEV-${String(d.numero).padStart(4, '0')}` : d.id.slice(0, 4).toUpperCase()}`,
        numeroCodigo: d.numero ? `DEV-${String(d.numero).padStart(4, '0')}` : `DEV-${d.id.slice(0, 4).toUpperCase()}`,
        descripcion: d.motivo || `Devolución de ${d.lines.length} ítem(s) por falla / garantía`,
        monto: Number(d.totalDevuelto),
        estado: d.estado,
        fecha: d.createdAt.toISOString(),
        detalles: {
          deudaDescontada: Number(d.deudaDescontada),
          saldoAFavor: Number(d.saldoAFavor),
          lineasCount: d.lines.length,
          lines: d.lines,
        },
      });
    });

    // Ordenar cronológicamente descendente
    movimientos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    return {
      supplier: this.formatSupplier(supplier),
      resumen: {
        totalFacturado,
        totalPagado,
        totalDevoluciones,
        saldoPendiente,
        totalOrdenes: supplier.orders.length,
        totalEntregas: supplier.entries.length,
        totalPagos: supplier.payments.length,
        totalDevolucionesCount: supplier.devoluciones.length,
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
      devoluciones: supplier.devoluciones.map((d) => ({
        ...d,
        totalDevuelto: Number(d.totalDevuelto),
        deudaDescontada: Number(d.deudaDescontada),
        saldoAFavor: Number(d.saldoAFavor),
      })),
    };
  }

  async obtenerOrdenCompra(id: string) {
    const order = await this.prisma.supplierOrder.findUnique({
      where: { id },
      include: {
        lines: true,
        supplier: {
          include: {
            tenant: { select: { id: true, name: true } },
          },
        },
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
        model: {
          include: {
            products: {
              where: { imageUrl: { not: null } },
              select: { imageUrl: true },
              take: 1,
            },
          },
        },
        serie: {
          include: {
            tallas: {
              orderBy: { numero: 'asc' },
            },
          },
        },
        stockByTalla: {
          include: {
            talla: true,
          },
        },
      },
    });

    const productMap = new Map<string, any>();
    products.forEach((p) => productMap.set(p.id, p));

    return {
      ...order,
      supplier: this.formatSupplier(order.supplier),
      sucursalNombre: order.supplier?.tenant?.name || '',
      total: Number(order.total),
      lines: order.lines.map((l) => {
        const prod = productMap.get(l.productId);
        const tallas = prod?.serie?.tallas?.map((t: any) => ({
          id: t.id,
          numero: t.numero,
          talla: t.numero,
        })) || prod?.stockByTalla?.map((st: any) => ({
          id: st.talla?.id || st.tallaId,
          numero: st.talla?.numero,
          talla: st.talla?.numero,
        })) || [];

        const fallbackImg = prod?.model?.products?.find((p: any) => p.imageUrl)?.imageUrl || '';
        const resolvedImageUrl = prod?.imageUrl || fallbackImg || '';

        return {
          ...l,
          precioCosto: Number(l.precioCosto),
          subtotal: Number(l.subtotal),
          producto: prod ? {
            id: prod.id,
            codigo: prod.code,
            color: prod.color,
            imageUrl: resolvedImageUrl,
            nombre: prod.model ? `${prod.model.brand} ${prod.model.name}` : prod.code,
            marca: prod.model?.brand,
            serie: prod.serie?.nombre || '',
            serieNombre: prod.serie?.nombre || '',
            tallas,
            reordenAutomatica: prod.reordenAutomatica ?? true,
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
      const targetTenants = await this.getOrganizationTenantIds(tenantId);
      where.supplier = targetTenants.length > 0 ? { tenantId: { in: targetTenants } } : { tenantId };
    }
    const orders = await this.prisma.supplierOrder.findMany({
      where,
      include: {
        supplier: {
          include: {
            tenant: { select: { id: true, name: true } },
          },
        },
        lines: true,
        entry: {
          select: { id: true, numero: true, fechaIngreso: true, estado: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Populate product thumbnails
    const allProductIds = Array.from(new Set(orders.flatMap((o) => o.lines.map((l) => l.productId))));
    const products = await this.prisma.product.findMany({
      where: { id: { in: allProductIds } },
      include: {
        model: {
          include: {
            products: {
              where: { imageUrl: { not: null } },
              select: { imageUrl: true },
              take: 1,
            },
          },
        },
        serie: {
          include: {
            tallas: {
              orderBy: { numero: 'asc' },
            },
          },
        },
        stockByTalla: {
          include: {
            talla: true,
          },
        },
      },
    });
    const productMap = new Map<string, any>();
    products.forEach((p) => productMap.set(p.id, p));

    return orders.map((o) => ({
      ...o,
      supplier: this.formatSupplier(o.supplier),
      sucursalNombre: o.supplier?.tenant?.name || '',
      total: Number(o.total),
      totalLineas: o.lines.length,
      lines: o.lines.map((l) => {
        const prod = productMap.get(l.productId);
        const tallas = prod?.serie?.tallas?.map((t: any) => ({
          id: t.id,
          numero: t.numero,
          talla: t.numero,
        })) || prod?.stockByTalla?.map((st: any) => ({
          id: st.talla?.id || st.tallaId,
          numero: st.talla?.numero,
          talla: st.talla?.numero,
        })) || [];

        const fallbackImg = prod?.model?.products?.find((p: any) => p.imageUrl)?.imageUrl || '';
        const resolvedImageUrl = prod?.imageUrl || fallbackImg || '';

        return {
          ...l,
          precioCosto: Number(l.precioCosto),
          subtotal: Number(l.subtotal),
          producto: prod ? {
            id: prod.id,
            codigo: prod.code,
            color: prod.color,
            imageUrl: resolvedImageUrl,
            nombre: prod.model ? `${prod.model.brand} ${prod.model.name}` : prod.code,
            marca: prod.model?.brand,
            serie: prod.serie?.nombre || '',
            serieNombre: prod.serie?.nombre || '',
            tallas,
            reordenAutomatica: prod.reordenAutomatica ?? true,
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
        supplier: {
          include: {
            tenant: { select: { id: true, name: true } },
          },
        },
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
      sucursalNombre: entry.supplier?.tenant?.name || '',
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
      const targetTenants = await this.getOrganizationTenantIds(tenantId);
      where.supplier = targetTenants.length > 0 ? { tenantId: { in: targetTenants } } : { tenantId };
    }
    const entries = await this.prisma.merchandiseEntry.findMany({
      where,
      include: {
        supplier: {
          include: {
            tenant: { select: { id: true, name: true } },
          },
        },
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
      sucursalNombre: e.supplier?.tenant?.name || '',
      total: Number(e.total),
      totalLineas: e.lines.length,
    }));
  }

  async listarTodosPagos(tenantId?: string | null) {
    const where: any = {};
    if (tenantId) {
      const targetTenants = await this.getOrganizationTenantIds(tenantId);
      where.supplier = targetTenants.length > 0 ? { tenantId: { in: targetTenants } } : { tenantId };
    }
    const payments = await this.prisma.supplierPayment.findMany({
      where,
      include: {
        supplier: {
          include: {
            tenant: { select: { id: true, name: true } },
          },
        },
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
      sucursalNombre: p.supplier?.tenant?.name || '',
    }));
  }

  private formatSupplier(raw: any) {
    if (!raw) return null;
    let rucDescifrado = raw.ruc;
    try {
      if (raw.ruc) {
        rucDescifrado = this.encryptionService.decrypt(raw.ruc);
      }
    } catch (e) {
      // Fallback
    }
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      sucursalNombre: raw.tenant?.name || '',
      ruc: rucDescifrado || '',
      razonSocial: raw.razonSocial || '',
      nombre: raw.razonSocial || '', // Alias for UI consistency
      contacto: raw.contacto || '',
      direccion: raw.direccion || '',
      email: raw.email || '',
      activo: raw.activo ?? true,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
