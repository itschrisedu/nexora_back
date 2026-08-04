import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';

/**
 * InventarioQueryService — Servicio de consultas de inventario.
 * Ejecuta queries directas a Prisma sin pasar por el Aggregate Root
 * ya que no hay lógica de negocio involucrada en las lecturas.
 */
@Injectable()
export class InventarioQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerProducto(id: string) {
    const producto = await this.prisma.product.findUnique({
      where: { id },
      include: {
        model: true,
        serie: true,
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
        model: true,
        serie: true,
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
        model: true,
        serie: true,
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
        model: true,
        serie: true,
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
    const where: any = {};
    if (tenantId) {
      where.tenantId = tenantId;
    }

    const modelos = await this.prisma.productModel.findMany({
      where,
      include: {
        products: {
          include: {
            serie: true,
            stockByTalla: {
              include: { talla: true },
              orderBy: { talla: { numero: 'asc' } },
            },
          },
          orderBy: { code: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return modelos.map((m: any) => ({
      id: m.id,
      baseCode: m.baseCode,
      name: m.name,
      brand: m.brand,
      material: m.material,
      active: m.active,
      createdAt: m.createdAt,
      products: m.products.map((p: any) => this.formatProducto(p, m)),
    }));
  }

  // ── Formatear respuesta ─────────────────────

  private formatProducto(record: any, modelo?: any) {
    const mdl = modelo || record.model;
    return {
      id: record.id,
      codigo: record.code,
      nombre: mdl?.name ?? '',
      marca: mdl?.brand ?? '',
      modelo: mdl?.baseCode ?? '',
      material: mdl?.material ?? null,
      color: record.color,
      fotoUrl: record.imageUrl,
      precioCosto: Number(record.costPrice),
      precioVenta: Number(record.salePrice),
      serie: record.serie
        ? { id: record.serie.id, nombre: record.serie.nombre }
        : null,
      activo: record.active,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      tallas: record.stockByTalla?.map((s: any) => ({
        id: s.tallaId,
        tallaId: s.tallaId,
        numero: s.talla?.numero,
        cantidad: s.quantity,
        stock: s.quantity,
        cantidadReservada: s.reservedQuantity,
        disponible: s.quantity - s.reservedQuantity,
        stockMinimo: s.minStock,
        bajoPorMinimo:
          s.minStock > 0 && s.quantity - s.reservedQuantity < s.minStock,
      })) || [],
      stockPorTalla: record.stockByTalla?.map((s: any) => ({
        id: s.tallaId,
        tallaId: s.tallaId,
        numero: s.talla?.numero,
        cantidad: s.quantity,
        stock: s.quantity,
        cantidadReservada: s.reservedQuantity,
        disponible: s.quantity - s.reservedQuantity,
        stockMinimo: s.minStock,
        bajoPorMinimo:
          s.minStock > 0 && s.quantity - s.reservedQuantity < s.minStock,
      })) || [],
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
}
