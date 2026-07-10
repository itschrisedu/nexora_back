import { Injectable, Logger } from '@nestjs/common';
import { IProductoRepository } from '../domain/IProductoRepository';
import { Producto, PriceHistoryEntry } from '../domain/Producto';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { Money } from '../../../shared/domain/Money';
import { Serie } from '../domain/value-objects/Serie';
import { StockPorTalla } from '../domain/value-objects/StockPorTalla';

@Injectable()
export class PrismaProductoRepository extends IProductoRepository {
  private readonly logger = new Logger(PrismaProductoRepository.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<Producto | null> {
    const record = await this.prisma.product.findUnique({
      where: { id },
      include: {
        serie: true,
        stockByTalla: true,
        priceHistory: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async findByCodigo(codigo: string): Promise<Producto | null> {
    const record = await this.prisma.product.findUnique({
      where: { codigo },
      include: {
        serie: true,
        stockByTalla: true,
        priceHistory: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async findBySerie(serieNombre: string): Promise<Producto[]> {
    const records = await this.prisma.product.findMany({
      where: { serie: { nombre: serieNombre } },
      include: {
        serie: true,
        stockByTalla: true,
        priceHistory: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { nombre: 'asc' },
    });

    return Promise.all(records.map((r: any) => this.toDomain(r)));
  }

  async findConStockBajo(): Promise<Producto[]> {
    const records = await this.prisma.product.findMany({
      where: {
        activo: true,
        stockByTalla: {
          some: {
            cantidad: { gt: 0 },
          },
        },
      },
      include: {
        serie: true,
        stockByTalla: true,
        priceHistory: { orderBy: { createdAt: 'desc' } },
      },
    });

    const productos = await Promise.all(records.map((r: any) => this.toDomain(r)));

    return productos.filter((p: Producto) => {
      for (const [, stock] of p.stockPorTalla) {
        if (stock.stockMinimo > 0 && stock.cantidadDisponible < stock.stockMinimo) {
          return true;
        }
      }
      return false;
    });
  }

  async save(producto: Producto): Promise<void> {
    const stockEntries: {
      tallaId: string;
      cantidad: number;
      cantidadReservada: number;
      stockMinimo: number;
    }[] = [];

    for (const [tallaId, stock] of producto.stockPorTalla) {
      stockEntries.push({
        tallaId,
        cantidad: stock.cantidad,
        cantidadReservada: stock.cantidadReservada,
        stockMinimo: stock.stockMinimo,
      });
    }

    const serieConfig = await this.prisma.seriesConfig.findUnique({
      where: { nombre: producto.serie.value }
    });

    if (!serieConfig) {
      throw new Error(`Serie ${producto.serie.value} no encontrada en la base de datos`);
    }

    await this.prisma.product.create({
      data: {
        id: producto.id,
        codigo: producto.codigo,
        nombre: producto.nombre,
        marca: producto.marca,
        modelo: producto.modelo,
        material: producto.material,
        fotoUrl: producto.fotoUrl,
        precioCosto: producto.precioCosto.amount,
        precioVenta: producto.precioVenta.amount,
        serieId: serieConfig.id,
        activo: producto.activo,
        stockByTalla: {
          createMany: { data: stockEntries },
        },
      },
    });

    this.logger.log(`Producto guardado: ${producto.codigo}`);
  }

  async update(producto: Producto): Promise<void> {
    await this.prisma.product.update({
      where: { id: producto.id },
      data: {
        nombre: producto.nombre,
        marca: producto.marca,
        modelo: producto.modelo,
        material: producto.material,
        fotoUrl: producto.fotoUrl,
        precioCosto: producto.precioCosto.amount,
        precioVenta: producto.precioVenta.amount,
        activo: producto.activo,
      },
    });

    for (const [tallaId, stock] of producto.stockPorTalla) {
      await this.prisma.stockByTalla.upsert({
        where: {
          productId_tallaId: {
            productId: producto.id,
            tallaId,
          },
        },
        update: {
          cantidad: stock.cantidad,
          cantidadReservada: stock.cantidadReservada,
          stockMinimo: stock.stockMinimo,
        },
        create: {
          productId: producto.id,
          tallaId,
          cantidad: stock.cantidad,
          cantidadReservada: stock.cantidadReservada,
          stockMinimo: stock.stockMinimo,
        },
      });
    }

    for (const entry of producto.priceHistory) {
      const exists = await this.prisma.priceHistory.findFirst({
        where: {
          productId: producto.id,
          createdAt: entry.createdAt,
        },
      });

      if (!exists) {
        await this.prisma.priceHistory.create({
          data: {
            productId: producto.id,
            precioCostoAnterior: entry.precioCostoAnterior.amount,
            precioVentaAnterior: entry.precioVentaAnterior.amount,
            precioCostoNuevo: entry.precioCostoNuevo.amount,
            precioVentaNuevo: entry.precioVentaNuevo.amount,
            cambiadoPorId: entry.cambiadoPorId,
            motivo: entry.motivo,
            createdAt: entry.createdAt,
          },
        });
      }
    }

    this.logger.log(`Producto actualizado: ${producto.codigo}`);
  }

  // ── Mapper Prisma → Domain ──────────────────

  private toDomain(record: any): Producto {
    const serie = Serie.create(record.serie.nombre);

    const stockPorTallaList: StockPorTalla[] = record.stockByTalla.map(
      (s: any) =>
        StockPorTalla.create(
          s.tallaId,
          s.cantidad,
          s.cantidadReservada,
          s.stockMinimo,
        ),
    );

    const historial: PriceHistoryEntry[] = record.priceHistory.map(
      (h: any) => ({
        precioCostoAnterior: Money.create(Number(h.precioCostoAnterior)),
        precioVentaAnterior: Money.create(Number(h.precioVentaAnterior)),
        precioCostoNuevo: Money.create(Number(h.precioCostoNuevo)),
        precioVentaNuevo: Money.create(Number(h.precioVentaNuevo)),
        cambiadoPorId: h.cambiadoPorId,
        motivo: h.motivo,
        createdAt: h.createdAt,
      }),
    );

    return Producto.reconstruir(
      record.id,
      record.codigo,
      record.nombre,
      record.marca,
      record.modelo,
      record.material,
      record.fotoUrl,
      Money.create(Number(record.precioCosto)),
      Money.create(Number(record.precioVenta)),
      serie,
      stockPorTallaList,
      historial,
      record.activo,
    );
  }
}
