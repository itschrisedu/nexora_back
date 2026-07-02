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
  }) {
    const where: any = { activo: true };

    if (filtros.q) {
      where.OR = [
        { nombre: { contains: filtros.q, mode: 'insensitive' } },
        { codigo: { contains: filtros.q, mode: 'insensitive' } },
        { modelo: { contains: filtros.q, mode: 'insensitive' } },
      ];
    }

    if (filtros.serie) {
      where.serie = { nombre: filtros.serie };
    }

    if (filtros.marca) {
      where.marca = { contains: filtros.marca, mode: 'insensitive' };
    }

    const productos = await this.prisma.product.findMany({
      where,
      include: {
        serie: true,
        stockByTalla: {
          include: { talla: true },
          orderBy: { talla: { numero: 'asc' } },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return productos.map((p: any) => this.formatProducto(p));
  }

  async obtenerProductosPorSerie(serieNombre: string) {
    const productos = await this.prisma.product.findMany({
      where: { serie: { nombre: serieNombre }, activo: true },
      include: {
        serie: true,
        stockByTalla: {
          include: { talla: true },
          orderBy: { talla: { numero: 'asc' } },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return productos.map((p: any) => this.formatProducto(p));
  }

  async obtenerStockBajo() {
    const productos = await this.prisma.product.findMany({
      where: {
        activo: true,
        stockByTalla: {
          some: {
            stockMinimo: { gt: 0 },
          },
        },
      },
      include: {
        serie: true,
        stockByTalla: {
          include: { talla: true },
          orderBy: { talla: { numero: 'asc' } },
        },
      },
    });

    const conStockBajo = productos.filter((p: any) =>
      p.stockByTalla.some(
        (s: any) => s.stockMinimo > 0 && s.cantidad - s.cantidadReservada < s.stockMinimo,
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

  // ── Formatear respuesta ─────────────────────

  private formatProducto(record: any) {
    return {
      id: record.id,
      codigo: record.codigo,
      nombre: record.nombre,
      marca: record.marca,
      modelo: record.modelo,
      material: record.material,
      fotoUrl: record.fotoUrl,
      precioCosto: Number(record.precioCosto),
      precioVenta: Number(record.precioVenta),
      serie: record.serie?.nombre ?? null,
      activo: record.activo,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      stockPorTalla: record.stockByTalla?.map((s: any) => ({
        tallaId: s.tallaId,
        numero: s.talla?.numero,
        cantidad: s.cantidad,
        cantidadReservada: s.cantidadReservada,
        disponible: s.cantidad - s.cantidadReservada,
        stockMinimo: s.stockMinimo,
        bajoPorMinimo:
          s.stockMinimo > 0 && s.cantidad - s.cantidadReservada < s.stockMinimo,
      })),
      priceHistory: record.priceHistory?.map((h: any) => ({
        precioCostoAnterior: Number(h.precioCostoAnterior),
        precioVentaAnterior: Number(h.precioVentaAnterior),
        precioCostoNuevo: Number(h.precioCostoNuevo),
        precioVentaNuevo: Number(h.precioVentaNuevo),
        motivo: h.motivo,
        createdAt: h.createdAt,
      })),
    };
  }
}
