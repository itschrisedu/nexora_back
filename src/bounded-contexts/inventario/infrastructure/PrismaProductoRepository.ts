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
        model: true,
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
      where: { code: codigo },
      include: {
        model: true,
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
        model: true,
        serie: true,
        stockByTalla: true,
        priceHistory: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { code: 'asc' },
    });

    return Promise.all(records.map((r: any) => this.toDomain(r)));
  }

  async findConStockBajo(): Promise<Producto[]> {
    const records = await this.prisma.product.findMany({
      where: {
        active: true,
        stockByTalla: {
          some: {
            quantity: { gt: 0 },
          },
        },
      },
      include: {
        model: true,
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
      quantity: number;
      reservedQuantity: number;
      minStock: number;
    }[] = [];

    for (const [tallaId, stock] of producto.stockPorTalla) {
      stockEntries.push({
        tallaId,
        quantity: stock.cantidad,
        reservedQuantity: stock.cantidadReservada,
        minStock: stock.stockMinimo,
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
        modelId: producto.modelId,
        code: producto.code,
        color: producto.color,
        imageUrl: producto.imageUrl,
        costPrice: producto.costPrice.amount,
        salePrice: producto.salePrice.amount,
        serieId: serieConfig.id,
        active: producto.active,
        stockByTalla: {
          createMany: { data: stockEntries },
        },
      },
    });

    this.logger.log(`Producto guardado: ${producto.code}`);
  }

  async update(producto: Producto): Promise<void> {
    await this.prisma.product.update({
      where: { id: producto.id },
      data: {
        color: producto.color,
        imageUrl: producto.imageUrl,
        costPrice: producto.costPrice.amount,
        salePrice: producto.salePrice.amount,
        active: producto.active,
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
          quantity: stock.cantidad,
          reservedQuantity: stock.cantidadReservada,
          minStock: stock.stockMinimo,
        },
        create: {
          productId: producto.id,
          tallaId,
          quantity: stock.cantidad,
          reservedQuantity: stock.cantidadReservada,
          minStock: stock.stockMinimo,
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
            previousCostPrice: entry.previousCostPrice.amount,
            previousSalePrice: entry.previousSalePrice.amount,
            newCostPrice: entry.newCostPrice.amount,
            newSalePrice: entry.newSalePrice.amount,
            changedById: entry.changedById,
            reason: entry.reason,
            createdAt: entry.createdAt,
          },
        });
      }
    }

    this.logger.log(`Producto actualizado: ${producto.code}`);
  }

  // ── Mapper Prisma → Domain ──────────────────

  private toDomain(record: any): Producto {
    const serie = Serie.create(record.serie.nombre);

    const stockPorTallaList: StockPorTalla[] = record.stockByTalla.map(
      (s: any) =>
        StockPorTalla.create(
          s.tallaId,
          s.quantity,
          s.reservedQuantity,
          s.minStock,
        ),
    );

    const historial: PriceHistoryEntry[] = record.priceHistory.map(
      (h: any) => ({
        previousCostPrice: Money.create(Number(h.previousCostPrice)),
        previousSalePrice: Money.create(Number(h.previousSalePrice)),
        newCostPrice: Money.create(Number(h.newCostPrice)),
        newSalePrice: Money.create(Number(h.newSalePrice)),
        changedById: h.changedById,
        reason: h.reason,
        createdAt: h.createdAt,
      }),
    );

    return Producto.reconstruir(
      record.id,
      record.modelId,
      record.code,
      record.color,
      record.imageUrl,
      Money.create(Number(record.costPrice)),
      Money.create(Number(record.salePrice)),
      serie,
      stockPorTallaList,
      historial,
      record.active,
      record.model?.name || '',
      record.model?.brand || '',
      record.model?.baseCode || '',
      record.model?.material || null,
    );
  }
}
