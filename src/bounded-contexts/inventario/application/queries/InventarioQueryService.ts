import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';
import { generarSiglaProveedor } from '../../../../shared/utils/text-formatters';

/**
 * InventarioQueryService — Servicio de consultas de inventario.
 * Ejecuta queries directas a Prisma sin pasar por el Aggregate Root
 * ya que no hay lógica de negocio involucrada en las lecturas.
 */
@Injectable()
export class InventarioQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async obtenerProducto(id: string) {
    const producto = await this.prisma.product.findUnique({
      where: { id },
      include: {
        model: {
          include: {
            supplier: true,
            tenant: { select: { id: true, name: true } },
          },
        },
        supplier: true,
        serie: {
          include: {
            tallas: { orderBy: { numero: 'asc' } },
          },
        },
        stockByTalla: {
          include: { talla: true },
          orderBy: { talla: { numero: 'asc' } },
        },
        priceHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!producto) {
      throw new NotFoundException(`Producto con ID "${id}" no encontrado`);
    }

    return this.formatProducto(producto);
  }

  async buscarProductos(filtros: {
    q?: string;
    serie?: string;
    marca?: string;
  }, tenantId?: string | null) {
    const where: any = { active: true };

    // Filtro multi-tenant
    if (tenantId) {
      where.model = { ...where.model, tenantId };
    }

    if (filtros.q) {
      where.OR = [
        { code: { contains: filtros.q, mode: 'insensitive' } },
        { color: { contains: filtros.q, mode: 'insensitive' } },
        { model: { name: { contains: filtros.q, mode: 'insensitive' }, ...(tenantId ? { tenantId } : {}) } },
        { model: { brand: { contains: filtros.q, mode: 'insensitive' }, ...(tenantId ? { tenantId } : {}) } },
        { model: { baseCode: { contains: filtros.q, mode: 'insensitive' }, ...(tenantId ? { tenantId } : {}) } },
      ];
    }

    if (filtros.serie) {
      where.serie = { nombre: filtros.serie };
    }

    if (filtros.marca) {
      where.model = { ...where.model, brand: { contains: filtros.marca, mode: 'insensitive' } };
    }

    const productos = await this.prisma.product.findMany({
      where,
      include: {
        model: {
          include: {
            supplier: true,
            tenant: { select: { id: true, name: true } },
          },
        },
        supplier: true,
        serie: {
          include: {
            tallas: { orderBy: { numero: 'asc' } },
          },
        },
        stockByTalla: {
          include: { talla: true },
          orderBy: { talla: { numero: 'asc' } },
        },
      },
      orderBy: { code: 'asc' },
    });

    return productos.map((p: any) => this.formatProducto(p));
  }

  async obtenerProductosPorSerie(serieNombre: string, tenantId?: string | null) {
    const where: any = { serie: { nombre: serieNombre }, active: true };
    if (tenantId) {
      where.model = { tenantId };
    }

    const productos = await this.prisma.product.findMany({
      where,
      include: {
        model: {
          include: {
            supplier: true,
            tenant: { select: { id: true, name: true } },
          },
        },
        supplier: true,
        serie: {
          include: {
            tallas: { orderBy: { numero: 'asc' } },
          },
        },
        stockByTalla: {
          include: { talla: true },
          orderBy: { talla: { numero: 'asc' } },
        },
      },
      orderBy: { code: 'asc' },
    });

    return productos.map((p: any) => this.formatProducto(p));
  }

  async obtenerStockBajo(tenantId?: string | null) {
    const where: any = {
      active: true,
      stockByTalla: {
        some: {
          minStock: { gt: 0 },
        },
      },
    };
    if (tenantId) {
      where.model = { tenantId };
    }

    const productos = await this.prisma.product.findMany({
      where,
      include: {
        model: {
          include: {
            supplier: true,
            tenant: { select: { id: true, name: true } },
          },
        },
        supplier: true,
        serie: {
          include: {
            tallas: { orderBy: { numero: 'asc' } },
          },
        },
        stockByTalla: {
          include: { talla: true },
          orderBy: { talla: { numero: 'asc' } },
        },
      },
    });

    const conStockBajo = productos.filter((p: any) =>
      p.stockByTalla.some(
        (s: any) => s.minStock > 0 && s.quantity - s.reservedQuantity < s.minStock,
      ),
    );

    return conStockBajo.map((p: any) => this.formatProducto(p));
  }

  async obtenerMovimientos(productoId: string) {
    const movimientos = await this.prisma.stockMovement.findMany({
      where: { productId: productoId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return movimientos;
  }

  async listarModelos(tenantId?: string | null) {
    if (!tenantId) {
      return [];
    }
    const where: any = { tenantId };

    const [modelos, allSuppliers] = await Promise.all([
      this.prisma.productModel.findMany({
        where,
        include: {
          supplier: true,
          tenant: { select: { id: true, name: true } },
          products: {
            include: {
              supplier: true,
              serie: {
                include: {
                  tallas: { orderBy: { numero: 'asc' } },
                },
              },
              stockByTalla: {
                include: { talla: true },
                orderBy: { talla: { numero: 'asc' } },
              },
            },
            orderBy: { code: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.supplier.findMany({
        where: { tenantId },
        include: {
          _count: { select: { orders: true } },
        },
      }),
    ]);

    const suppliersMap = new Map<string, any>(
      allSuppliers.map((s) => [
        s.id,
        {
          id: s.id,
          razonSocial: s.razonSocial,
          ruc: s.ruc,
          contacto: s.contacto,
          direccion: s.direccion,
          email: s.email,
          totalOrdenes: s._count?.orders || 0,
        },
      ]),
    );

    return modelos.map((m: any) => {
      const associatedSuppliers: any[] = [];
      const seenIds = new Set<string>();

      if (m.supplierId && suppliersMap.has(m.supplierId)) {
        const sup = suppliersMap.get(m.supplierId);
        associatedSuppliers.push({
          ...sup,
          isPrimary: true,
        });
        seenIds.add(m.supplierId);
      } else if (m.supplier && m.supplier.tenantId === tenantId) {
        let decRuc = m.supplier.ruc;
        try {
          decRuc = this.encryptionService.decrypt(m.supplier.ruc);
        } catch {}
        associatedSuppliers.push({
          id: m.supplier.id,
          razonSocial: m.supplier.razonSocial,
          ruc: decRuc,
          contacto: m.supplier.contacto,
          direccion: m.supplier.direccion,
          email: m.supplier.email,
          totalOrdenes: 0,
          isPrimary: true,
        });
        seenIds.add(m.supplier.id);
      }

      if (Array.isArray(m.alternateSupplierIds)) {
        for (const altId of m.alternateSupplierIds) {
          if (!seenIds.has(altId) && suppliersMap.has(altId)) {
            associatedSuppliers.push({
              ...suppliersMap.get(altId),
              isPrimary: false,
            });
            seenIds.add(altId);
          }
        }
      }

      let mostFrequentId: string | null = null;
      let maxOrders = -1;
      for (const s of associatedSuppliers) {
        if (s.totalOrdenes > maxOrders) {
          maxOrders = s.totalOrdenes;
          mostFrequentId = s.id;
        }
      }

      const enrichedSuppliers = associatedSuppliers.map((s) => ({
        ...s,
        isMostFrequent: s.id === mostFrequentId && maxOrders > 0,
      }));

      return {
        id: m.id,
        tenantId: m.tenantId,
        sucursalNombre: m.tenant?.name || '',
        baseCode: m.baseCode,
        name: m.name,
        brand: m.brand,
        material: m.material,
        active: m.active,
        reordenAutomatica: m.reordenAutomatica,
        supplierId: (m.supplierId && (suppliersMap.has(m.supplierId) || (m.supplier && m.supplier.tenantId === tenantId))) ? m.supplierId : null,
        supplier: (m.supplierId && suppliersMap.has(m.supplierId))
          ? {
              id: m.supplier.id,
              razonSocial: m.supplier.razonSocial,
              ruc: m.supplier.ruc,
              contacto: m.supplier.contacto,
              direccion: m.supplier.direccion,
              email: m.supplier.email,
            }
          : (m.supplier && m.supplier.tenantId === tenantId)
          ? {
              id: m.supplier.id,
              razonSocial: m.supplier.razonSocial,
              ruc: m.supplier.ruc,
              contacto: m.supplier.contacto,
              direccion: m.supplier.direccion,
              email: m.supplier.email,
            }
          : null,
        alternateSupplierIds: m.alternateSupplierIds || [],
        suppliers: enrichedSuppliers,
        createdAt: m.createdAt,
        products: m.products.map((p: any) => this.formatProducto(p, m)),
      };
    });
  }

  // ── Formatear respuesta ─────────────────────

  private formatProducto(record: any, modelo?: any) {
    const mdl = modelo || record.model;
    const existingStockMap = new Map<string, any>();
    (record.stockByTalla || []).forEach((s: any) => {
      const numKey = s.talla?.numero ? String(s.talla.numero) : s.tallaId;
      existingStockMap.set(numKey, s);
      existingStockMap.set(s.tallaId, s);
    });

    const allTallas: any[] = [];
    const seenTallaIds = new Set<string>();

    if (record.serie?.tallas && Array.isArray(record.serie.tallas)) {
      record.serie.tallas.forEach((t: any) => {
        seenTallaIds.add(t.id);
        seenTallaIds.add(String(t.numero));
        const stockEntry = existingStockMap.get(t.id) || existingStockMap.get(String(t.numero));
        const qty = stockEntry?.quantity ?? 0;
        const resQty = stockEntry?.reservedQuantity ?? 0;
        const minStk = stockEntry?.minStock ?? 0;
        allTallas.push({
          id: t.id,
          tallaId: t.id,
          numero: t.numero,
          cantidad: qty,
          stock: qty,
          ratio: 1,
          cantidadSerie: 1,
          cantidadReservada: resQty,
          disponible: qty - resQty,
          stockMinimo: minStk,
          bajoPorMinimo: minStk > 0 && qty - resQty < minStk,
        });
      });
    }

    (record.stockByTalla || []).forEach((s: any) => {
      if (!seenTallaIds.has(s.tallaId) && (!s.talla?.numero || !seenTallaIds.has(String(s.talla.numero)))) {
        const qty = s.quantity ?? 0;
        const resQty = s.reservedQuantity ?? 0;
        const minStk = s.minStock ?? 0;
        allTallas.push({
          id: s.tallaId,
          tallaId: s.tallaId,
          numero: s.talla?.numero ?? s.tallaId,
          cantidad: qty,
          stock: qty,
          ratio: 1,
          cantidadSerie: 1,
          cantidadReservada: resQty,
          disponible: qty - resQty,
          stockMinimo: minStk,
          bajoPorMinimo: minStk > 0 && qty - resQty < minStk,
        });
      }
    });

    allTallas.sort((a, b) => (Number(a.numero) || 0) - (Number(b.numero) || 0));

    const positiveQuantities = allTallas.map((s: any) => s.cantidad).filter((q: number) => q > 0);
    const minPositive = positiveQuantities.length > 0 ? Math.min(...positiveQuantities) : 1;
    allTallas.forEach((t) => {
      const r = minPositive > 0 && t.cantidad > 0 ? Math.max(1, Math.round(t.cantidad / minPositive)) : 1;
      t.ratio = r;
      t.cantidadSerie = r;
    });

    const variantSupplier = (record.supplier && (!record.tenantId || record.supplier.tenantId === record.tenantId))
      ? record.supplier
      : (mdl?.supplier && (!mdl?.tenantId || mdl.supplier.tenantId === mdl.tenantId))
      ? mdl.supplier
      : null;
    const supplierSigla = variantSupplier?.razonSocial ? generarSiglaProveedor(variantSupplier.razonSocial) : '';

    let supRuc = variantSupplier?.ruc;
    if (supRuc) {
      try {
        supRuc = this.encryptionService.decrypt(supRuc);
      } catch {}
    }

    let fotoUrl = record.imageUrl || null;
    if (!fotoUrl && mdl?.products && Array.isArray(mdl.products)) {
      const sibling = mdl.products.find(
        (sp: any) => sp.color?.trim().toUpperCase() === record.color?.trim().toUpperCase() && sp.imageUrl
      );
      if (sibling?.imageUrl) {
        fotoUrl = sibling.imageUrl;
      }
    }

    return {
      id: record.id,
      tenantId: mdl?.tenantId,
      sucursalNombre: mdl?.tenant?.name || '',
      codigo: record.code,
      nombre: mdl?.name ?? '',
      marca: mdl?.brand ?? '',
      modelo: mdl?.baseCode ?? '',
      material: mdl?.material ?? null,
      color: record.color,
      fotoUrl,
      precioCosto: Number(record.costPrice),
      precioVenta: Number(record.salePrice),
      supplierId: record.supplierId || mdl?.supplierId || null,
      supplier: variantSupplier
        ? {
            id: variantSupplier.id,
            razonSocial: variantSupplier.razonSocial,
            ruc: supRuc,
            contacto: variantSupplier.contacto,
            direccion: variantSupplier.direccion,
            email: variantSupplier.email,
          }
        : null,
      supplierSigla,
      serie: record.serie
        ? { id: record.serie.id, nombre: record.serie.nombre }
        : null,
      activo: record.active,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      tallas: allTallas,
      stockPorTalla: allTallas.map((s: any) => ({
        id: s.tallaId,
        tallaId: s.tallaId,
        numero: s.numero,
        cantidad: s.cantidad,
        stock: s.cantidad,
        cantidadReservada: s.cantidadReservada,
        disponible: s.disponible,
        stockMinimo: s.stockMinimo,
        bajoPorMinimo: s.bajoPorMinimo,
      })),
      priceHistory: record.priceHistory?.map((h: any) => ({
        precioCostoAnterior: Number(h.previousCostPrice),
        precioVentaAnterior: Number(h.previousSalePrice),
        precioCostoNuevo: Number(h.newCostPrice),
        precioVentaNuevo: Number(h.newSalePrice),
        motivo: h.reason,
        createdAt: h.createdAt,
      })),
    };
  }

  /**
   * Obtiene los modelos creados en la red comercial (Matriz u otras Sucursales de la misma empresa)
   * para que cualquier sucursal o la matriz puedan importarlos con todas sus variantes o variantes faltantes.
   */
  async obtenerModelosRed(currentTenantId?: string | null, userId?: string) {
    if (!currentTenantId) {
      return {
        isMatriz: false,
        redSucursales: [],
        modelosRed: [],
        totalDisponibles: 0,
        totalParciales: 0,
        totalCompletos: 0,
      };
    }

    // 1. Obtener datos del tenant actual y del usuario
    const [currentTenant, currentUser] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: currentTenantId },
        include: { businessConfig: true },
      }),
      userId
        ? this.prisma.user.findUnique({
            where: { id: userId },
            include: { parent: true },
          })
        : null,
    ]);

    let plainRuc: string | null = null;
    if (currentTenant?.businessConfig?.ruc) {
      try {
        plainRuc = this.encryptionService.decrypt(currentTenant.businessConfig.ruc);
      } catch {
        plainRuc = currentTenant.businessConfig.ruc;
      }
    }

    // 2. Resolver todos los tenants pertenecientes al mismo negocio
    const allTenants = await this.prisma.tenant.findMany({
      where: { active: true },
      include: { businessConfig: true },
      orderBy: { createdAt: 'asc' },
    });

    const relatedTenants = allTenants.filter((t) => {
      if (t.id === currentTenantId) return true;
      if (currentUser?.parent?.tenantId && t.id === currentUser.parent.tenantId) return true;
      if (plainRuc && t.businessConfig?.ruc) {
        try {
          const dec = this.encryptionService.decrypt(t.businessConfig.ruc);
          return dec === plainRuc;
        } catch {
          return t.businessConfig.ruc === plainRuc;
        }
      }
      return false;
    });

    const siblingTenants = relatedTenants.filter((t) => t.id !== currentTenantId);
    const siblingTenantIds = siblingTenants.map((t) => t.id);

    if (siblingTenantIds.length === 0) {
      return {
        isMatriz: relatedTenants.length <= 1,
        redSucursales: [],
        modelosRed: [],
        totalDisponibles: 0,
        totalParciales: 0,
        totalCompletos: 0,
      };
    }

    // 3. Consultar modelos de la red y modelos del local actual
    const [modelosRedRaw, modelosLocales] = await Promise.all([
      this.prisma.productModel.findMany({
        where: {
          tenantId: { in: siblingTenantIds },
          active: true,
        },
        include: {
          tenant: { select: { id: true, name: true } },
          supplier: true,
          products: {
            where: { active: true },
            include: {
              supplier: true,
              serie: {
                include: {
                  tallas: { orderBy: { numero: 'asc' } },
                },
              },
              stockByTalla: {
                include: { talla: true },
                orderBy: { talla: { numero: 'asc' } },
              },
            },
            orderBy: { code: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.productModel.findMany({
        where: { tenantId: currentTenantId, active: true },
        include: {
          products: {
            where: { active: true },
            select: { id: true, color: true, serieId: true },
          },
        },
      }),
    ]);

    // Mapa de modelos locales por nombre normalizado y por baseCode
    const localModelMap = new Map<string, { id: string; name: string; baseCode: string; variants: { color: string; serieId: string }[] }>();
    modelosLocales.forEach((lm) => {
      const normName = lm.name.trim().toUpperCase();
      localModelMap.set(normName, {
        id: lm.id,
        name: lm.name,
        baseCode: lm.baseCode,
        variants: lm.products.map((p) => ({
          color: p.color.trim().toUpperCase(),
          serieId: p.serieId,
        })),
      });
      localModelMap.set(lm.baseCode.trim().toUpperCase(), {
        id: lm.id,
        name: lm.name,
        baseCode: lm.baseCode,
        variants: lm.products.map((p) => ({
          color: p.color.trim().toUpperCase(),
          serieId: p.serieId,
        })),
      });
    });

    let totalDisponibles = 0;
    let totalParciales = 0;
    let totalCompletos = 0;

    const modelosRed = modelosRedRaw.map((m: any) => {
      const normName = m.name.trim().toUpperCase();
      const normBaseCode = m.baseCode.trim().toUpperCase();
      const localMatch = localModelMap.get(normName) || localModelMap.get(normBaseCode);

      const localVariantsSet = new Set<string>();
      if (localMatch) {
        localMatch.variants.forEach((v) => {
          localVariantsSet.add(`${v.color}__${v.serieId}`);
        });
      }

      const colorImageMap = new Map<string, string>();
      for (const prod of m.products) {
        const cKey = prod.color.trim().toUpperCase();
        if (prod.imageUrl && !colorImageMap.has(cKey)) {
          colorImageMap.set(cKey, prod.imageUrl);
        }
      }

      const colorMap = new Map<string, { color: string; fotoUrl: string | null }>();
      const seriesMap = new Map<
        string,
        { id: string; nombre: string; tallas: number[]; costPrice: number; salePrice: number }
      >();

      const missingVariants: any[] = [];
      const existingVariants: any[] = [];

      for (const prod of m.products) {
        const cKey = prod.color.trim().toUpperCase();
        const bestColorFoto = prod.imageUrl || colorImageMap.get(cKey) || null;

        if (!colorMap.has(cKey)) {
          colorMap.set(cKey, {
            color: prod.color,
            fotoUrl: bestColorFoto,
          });
        } else if (!colorMap.get(cKey)?.fotoUrl && bestColorFoto) {
          colorMap.set(cKey, {
            color: prod.color,
            fotoUrl: bestColorFoto,
          });
        }

        if (prod.serie && !seriesMap.has(prod.serie.id)) {
          const tallasNums = prod.serie.tallas
            ? prod.serie.tallas.map((t: any) => t.numero)
            : [];
          seriesMap.set(prod.serie.id, {
            id: prod.serie.id,
            nombre: prod.serie.nombre,
            tallas: tallasNums,
            costPrice: Number(prod.costPrice) || 0,
            salePrice: Number(prod.salePrice) || 0,
          });
        }

        const variantKey = `${cKey}__${prod.serieId}`;
        let variantSupRuc = prod.supplier?.ruc;
        if (variantSupRuc) {
          try {
            variantSupRuc = this.encryptionService.decrypt(variantSupRuc);
          } catch {}
        }

        const formattedVariant = {
          id: prod.id,
          code: prod.code,
          color: prod.color,
          imageUrl: bestColorFoto,
          costPrice: Number(prod.costPrice) || 0,
          salePrice: Number(prod.salePrice) || 0,
          serieId: prod.serieId,
          serieNombre: prod.serie?.nombre || '',
          tallas: (prod.serie?.tallas || []).map((t: any) => t.numero),
          supplierId: prod.supplierId || m.supplierId || null,
          supplier: prod.supplier
            ? {
                id: prod.supplier.id,
                razonSocial: prod.supplier.razonSocial,
                ruc: variantSupRuc,
                contacto: prod.supplier.contacto,
              }
            : null,
        };

        if (localVariantsSet.has(variantKey)) {
          existingVariants.push(formattedVariant);
        } else {
          missingVariants.push(formattedVariant);
        }
      }

      let status: 'DISPONIBLE' | 'PARCIAL' | 'COMPLETO' = 'DISPONIBLE';
      if (!localMatch) {
        status = 'DISPONIBLE';
        totalDisponibles++;
      } else if (missingVariants.length === 0) {
        status = 'COMPLETO';
        totalCompletos++;
      } else {
        status = 'PARCIAL';
        totalParciales++;
      }

      const minCosto =
        m.products.length > 0
          ? Math.min(...m.products.map((p: any) => Number(p.costPrice) || 0))
          : 0;
      const minVenta =
        m.products.length > 0
          ? Math.min(...m.products.map((p: any) => Number(p.salePrice) || 0))
          : 0;

      let modelSupRuc = m.supplier?.ruc;
      if (modelSupRuc) {
        try {
          modelSupRuc = this.encryptionService.decrypt(modelSupRuc);
        } catch {}
      }

      return {
        id: m.id,
        tenantId: m.tenantId,
        sucursalOrigenNombre: m.tenant?.name || 'Otra Sucursal',
        baseCode: m.baseCode,
        name: m.name,
        brand: m.brand,
        material: m.material || '',
        status,
        yaImportado: status === 'COMPLETO',
        parcial: status === 'PARCIAL',
        totalVariantesRed: m.products.length,
        variantesFaltantes: missingVariants,
        variantesExistentes: existingVariants,
        localModelId: localMatch?.id || null,
        colores: Array.from(colorMap.values()),
        series: Array.from(seriesMap.values()),
        precioCostoReferencial: minCosto,
        precioVentaReferencial: minVenta,
        fotoPrincipal:
          Array.from(colorMap.values()).find((c) => c.fotoUrl)?.fotoUrl || null,
        supplier: m.supplier
          ? {
              id: m.supplier.id,
              razonSocial: m.supplier.razonSocial,
              ruc: modelSupRuc,
              contacto: m.supplier.contacto,
            }
          : null,
      };
    });

    return {
      isMatriz: false,
      redSucursales: siblingTenants.map((s) => ({ id: s.id, nombre: s.name })),
      modelosRed,
      totalDisponibles,
      totalParciales,
      totalCompletos,
    };
  }

  /**
   * Alias de compatibilidad hacia atrás para obtenerModelosMatriz
   */
  async obtenerModelosMatriz(currentTenantId?: string | null, userId?: string) {
    const res = await this.obtenerModelosRed(currentTenantId, userId);
    return {
      isMatriz: res.isMatriz,
      matrizName: res.redSucursales[0]?.nombre || 'Matriz / Red',
      modelosMatriz: res.modelosRed,
    };
  }
}

