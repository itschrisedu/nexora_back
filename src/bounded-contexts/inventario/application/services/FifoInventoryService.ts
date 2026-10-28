import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';

export interface RegistrarLoteDto {
  productId: string;
  tallaId: string;
  cantidad: number;
  precioCosto: number;
  origen: 'ORDER_PURCHASE' | 'MANUAL_ENTRY' | 'DEVOLUCION_CLIENTE' | 'AJUSTE' | string;
  referenceId?: string;
  tx?: any;
}

export interface DescontarFifoDto {
  productId: string;
  tallaId: string;
  cantidad: number;
  tx?: any;
}

export interface ConsumoLoteItem {
  lotId: string;
  unitCost: number;
  quantity: number;
}

export interface ResultadoDescuentoFifo {
  totalDescontado: number;
  costoPromedioPonderado: number;
  consumos: ConsumoLoteItem[];
}

@Injectable()
export class FifoInventoryService {
  private readonly logger = new Logger(FifoInventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un nuevo lote de entrada con trazabilidad FIFO.
   */
  async registrarLoteEntrada(dto: RegistrarLoteDto) {
    if (!dto.cantidad || dto.cantidad <= 0) return null;

    const db = dto.tx || this.prisma;
    const unitCost = Number(dto.precioCosto) > 0 ? Number(dto.precioCosto) : 10;

    const lote = await db.inventoryLot.create({
      data: {
        productId: dto.productId,
        tallaId: dto.tallaId,
        unitCost,
        quantity: dto.cantidad,
        remainingQuantity: dto.cantidad,
        origin: dto.origen,
        referenceId: dto.referenceId ?? null,
        entryDate: new Date(),
      },
    });

    this.logger.log(
      `📦 Lote FIFO creado [ID ${lote.id}]: Producto ${dto.productId}, Talla ${dto.tallaId}, Cantidad: ${dto.cantidad}, Costo: $${unitCost}, Origen: ${dto.origen}`,
    );

    return lote;
  }

  /**
   * Descuenta stock en orden FIFO (del lote más antiguo con unidades remanentes al más nuevo).
   * Si las unidades sobrepasan los lotes registrados (p.ej. stock previo a la activación FIFO),
   * descuenta el remanente usando el costo base del producto para preservar 100% la compatibilidad.
   */
  async descontarStockFifo(dto: DescontarFifoDto): Promise<ResultadoDescuentoFifo> {
    if (!dto.cantidad || dto.cantidad <= 0) {
      return { totalDescontado: 0, costoPromedioPonderado: 0, consumos: [] };
    }

    const db = dto.tx || this.prisma;
    let pendiente = dto.cantidad;
    const consumos: ConsumoLoteItem[] = [];

    // 1. Buscar lotes con saldo para este producto y talla ordenados por fecha FIFO (ascendente)
    let lotes = await db.inventoryLot.findMany({
      where: {
        productId: dto.productId,
        tallaId: dto.tallaId,
        remainingQuantity: { gt: 0 },
      },
      orderBy: { entryDate: 'asc' },
    });

    // Si no hay lotes específicos para esa talla, buscar a nivel de producto como contingencia
    if (lotes.length === 0) {
      lotes = await db.inventoryLot.findMany({
        where: {
          productId: dto.productId,
          remainingQuantity: { gt: 0 },
        },
        orderBy: { entryDate: 'asc' },
      });
    }

    for (const lot of lotes) {
      if (pendiente <= 0) break;

      const aDescontar = Math.min(lot.remainingQuantity, pendiente);
      const nuevaCantidadRemanente = lot.remainingQuantity - aDescontar;

      await db.inventoryLot.update({
        where: { id: lot.id },
        data: { remainingQuantity: nuevaCantidadRemanente },
      });

      consumos.push({
        lotId: lot.id,
        unitCost: Number(lot.unitCost),
        quantity: aDescontar,
      });

      pendiente -= aDescontar;
    }

    // 2. Si todavía queda cantidad pendiente (stock previo sin lote), usar el costo base del producto
    if (pendiente > 0) {
      const prod = await db.product.findUnique({
        where: { id: dto.productId },
        select: { costPrice: true },
      });
      const fallbackCost = prod?.costPrice ? Number(prod.costPrice) : 10;

      consumos.push({
        lotId: 'STOCK_BASE_HISTORICO',
        unitCost: fallbackCost,
        quantity: pendiente,
      });
    }

    // 3. FASE FIFO (Opción B): Si el lote anterior se agotó en esta salida,
    // transicionar automáticamente el precio de venta al siguiente lote FIFO activo.
    try {
      const loteActivoVigente = await db.inventoryLot.findFirst({
        where: {
          productId: dto.productId,
          remainingQuantity: { gt: 0 },
        },
        orderBy: { entryDate: 'asc' },
      });

      if (loteActivoVigente) {
        const nuevoCostoActivo = Number(loteActivoVigente.unitCost);
        const prod = await db.product.findUnique({
          where: { id: dto.productId },
          select: { id: true, costPrice: true, salePrice: true, modelId: true },
        });

        if (prod && nuevoCostoActivo > 0) {
          const currentCost = Number(prod.costPrice);
          const currentSale = Number(prod.salePrice);
          const costChanged = Math.abs(nuevoCostoActivo - currentCost) > 0.001;
          const isUnderpriced = currentSale <= nuevoCostoActivo;

          if (costChanged || isUnderpriced) {
            let marginPct = 0.25;
            if (currentSale > currentCost && currentCost > 0) {
              marginPct = (currentSale - currentCost) / currentSale;
            }
            marginPct = Math.max(0.15, Math.min(0.50, marginPct));
            let newSalePrice = Number((nuevoCostoActivo / (1 - marginPct)).toFixed(2));
            if (newSalePrice <= nuevoCostoActivo) {
              newSalePrice = Number((nuevoCostoActivo * 1.25).toFixed(2));
            }

            await db.product.update({
              where: { id: prod.id },
              data: {
                costPrice: nuevoCostoActivo,
                salePrice: newSalePrice,
              },
            });

            await db.priceHistory.create({
              data: {
                productId: prod.id,
                previousCostPrice: prod.costPrice,
                previousSalePrice: prod.salePrice,
                newCostPrice: nuevoCostoActivo,
                newSalePrice: newSalePrice,
                changedById: 'FIFO_AUTO_TRANSITION',
                reason: `Transición automática FIFO: Agotado lote anterior ($${currentCost}). Activado lote vigente a costo $${nuevoCostoActivo} con PVP $${newSalePrice}`,
                createdAt: new Date(),
              },
            });

            this.logger.log(
              `🔄 [Transición FIFO] Producto ${prod.id}: Agotado lote previo ($${currentCost}). Activado nuevo lote -> Costo: $${nuevoCostoActivo}, Nuevo PVP: $${newSalePrice}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Error en transición automática FIFO de precio para producto ${dto.productId}:`, err);
    }

    const totalCosto = consumos.reduce((acc, c) => acc + c.unitCost * c.quantity, 0);
    const costoPromedioPonderado = dto.cantidad > 0 ? Number((totalCosto / dto.cantidad).toFixed(2)) : 0;

    return {
      totalDescontado: dto.cantidad,
      costoPromedioPonderado,
      consumos,
    };
  }

  /**
   * Obtiene el costo del lote FIFO activo para un producto (el lote más antiguo vigente con stock > 0).
   * Al terminarse ese lote, pasa automáticamente al siguiente lote disponible.
   */
  async obtenerCostoFifoActivo(productId: string): Promise<number> {
    const activeLot = await this.prisma.inventoryLot.findFirst({
      where: {
        productId,
        remainingQuantity: { gt: 0 },
      },
      orderBy: { entryDate: 'asc' },
      select: { unitCost: true },
    });

    if (activeLot) {
      return Number(activeLot.unitCost);
    }

    // Si no hay lotes activos vigentes, fallback al costo base del producto
    const prod = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { costPrice: true },
    });

    return prod?.costPrice ? Number(prod.costPrice) : 10;
  }

  /**
   * Obtiene el costo del último lote ingresado para sugerir en el modal de ingreso manual.
   */
  async obtenerUltimoCostoLote(productId: string): Promise<number> {
    const lastLot = await this.prisma.inventoryLot.findFirst({
      where: { productId },
      orderBy: { entryDate: 'desc' },
      select: { unitCost: true },
    });

    if (lastLot) {
      return Number(lastLot.unitCost);
    }

    const prod = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { costPrice: true },
    });

    return prod?.costPrice ? Number(prod.costPrice) : 10;
  }

  /**
   * Obtiene los costos FIFO activos y últimos costos para una lista masiva de productos (para catálogos y listas).
   */
  async obtenerCostosFifoMasivos(productIds: string[]): Promise<{
    costosActivos: Map<string, number>;
    ultimosCostos: Map<string, number>;
  }> {
    const costosActivos = new Map<string, number>();
    const ultimosCostos = new Map<string, number>();

    if (!productIds || productIds.length === 0) {
      return { costosActivos, ultimosCostos };
    }

    // Consultar todos los lotes de los productos en cuestión
    const lotes = await this.prisma.inventoryLot.findMany({
      where: { productId: { in: productIds } },
      orderBy: { entryDate: 'asc' },
      select: {
        id: true,
        productId: true,
        unitCost: true,
        remainingQuantity: true,
        entryDate: true,
      },
    });

    for (const lot of lotes) {
      // 1. Activo: el primer lote (más antiguo) que tenga remainingQuantity > 0
      if (lot.remainingQuantity > 0 && !costosActivos.has(lot.productId)) {
        costosActivos.set(lot.productId, Number(lot.unitCost));
      }
      // 2. Último: se sobreescribe sucesivamente para quedarse con el más reciente
      ultimosCostos.set(lot.productId, Number(lot.unitCost));
    }

    return { costosActivos, ultimosCostos };
  }

  /**
   * Retorna información detallada de los lotes de un producto para inspección.
   */
  async obtenerDetalleFifoProducto(productId: string) {
    const [lotes, prod] = await Promise.all([
      this.prisma.inventoryLot.findMany({
        where: { productId },
        include: { talla: true },
        orderBy: { entryDate: 'asc' },
      }),
      this.prisma.product.findUnique({
        where: { id: productId },
        select: { costPrice: true, salePrice: true, code: true, color: true },
      }),
    ]);

    const activeLot = lotes.find((l) => l.remainingQuantity > 0);
    const lastLot = lotes.length > 0 ? lotes[lotes.length - 1] : null;

    return {
      productId,
      baseCost: prod?.costPrice ? Number(prod.costPrice) : 10,
      activeCost: activeLot ? Number(activeLot.unitCost) : prod?.costPrice ? Number(prod.costPrice) : 10,
      lastCost: lastLot ? Number(lastLot.unitCost) : prod?.costPrice ? Number(prod.costPrice) : 10,
      totalStockEnLotes: lotes.reduce((acc, l) => acc + l.remainingQuantity, 0),
      lotes: lotes.map((l) => ({
        id: l.id,
        talla: l.talla?.numero ? `T${l.talla.numero}` : l.tallaId,
        unitCost: Number(l.unitCost),
        quantity: l.quantity,
        remainingQuantity: l.remainingQuantity,
        entryDate: l.entryDate,
        origin: l.origin,
        referenceId: l.referenceId,
      })),
    };
  }

  /**
   * Sincroniza el nuevo costo y el precio de venta sugerido (con margen comercial)
   * en todos los demás colores / variantes del mismo modelo para que las próximas compras,
   * sugerencias de ingreso y ventas mantengan la coherencia y rentabilidad.
   */
  async sincronizarHermanosMismoModelo(params: {
    modelId?: string | null;
    sourceProductId: string;
    nuevoCosto: number;
    userId?: string;
    motivo?: string;
    tx?: any;
  }) {
    const { modelId, sourceProductId, nuevoCosto, userId = 'SISTEMA', motivo, tx } = params;
    if (!modelId || !nuevoCosto || nuevoCosto <= 0) return;

    const db = tx || this.prisma;

    try {
      const sourceProd = await db.product.findUnique({
        where: { id: sourceProductId },
        select: { id: true, supplierId: true, serieId: true },
      });

      const hermanos = await db.product.findMany({
        where: {
          modelId,
          id: { not: sourceProductId },
          active: true,
          // La sincronización se restringe estrictamente a la MISMA serie
          // (ej: Caballero con Caballero), ya que cada serie (Caballero, Damas, Niños)
          // maneja tarifas y consumo de material totalmente distintos por proveedor.
          ...(sourceProd?.serieId ? { serieId: sourceProd.serieId } : {}),
        },
      });

      for (const h of hermanos) {
        // Si el color hermano tiene un proveedor diferente asignado,
        // se respeta su propia tarifa comercial y no se sobreescribe su costo.
        if (
          sourceProd?.supplierId &&
          h.supplierId &&
          sourceProd.supplierId !== h.supplierId
        ) {
          continue;
        }

        // En Opción B: Si el hermano tiene lotes anteriores con stock disponible > 0,
        // no le cambiamos el precio de venta en vitrina todavía. Se esperará a que se agoten sus lotes.
        const saldoLotesH = await db.inventoryLot.count({
          where: {
            productId: h.id,
            remainingQuantity: { gt: 0 },
          },
        });

        if (saldoLotesH > 0) {
          // Tiene stock disponible de lotes anteriores: no sobreescribir su precio de venta en mostrador
          continue;
        }

        const hCost = Number(h.costPrice);
        const hSale = Number(h.salePrice);
        const costChanged = Math.abs(nuevoCosto - hCost) > 0.001;
        const isUnderpriced = hSale <= nuevoCosto;

        if (costChanged || isUnderpriced) {
          let hMargin = 0.25;
          if (hSale > hCost && hCost > 0) {
            hMargin = (hSale - hCost) / hSale;
          }
          hMargin = Math.max(0.15, Math.min(0.50, hMargin));
          let hNewSale = Number((nuevoCosto / (1 - hMargin)).toFixed(2));
          if (hNewSale <= nuevoCosto) {
            hNewSale = Number((nuevoCosto * 1.25).toFixed(2));
          }

          await db.priceHistory.create({
            data: {
              productId: h.id,
              previousCostPrice: hCost,
              previousSalePrice: hSale,
              newCostPrice: nuevoCosto,
              newSalePrice: hNewSale,
              changedById: userId,
              reason: motivo || `Sincronización automática por nuevo costo del modelo ($${nuevoCosto})`,
              createdAt: new Date(),
            },
          });

          await db.product.update({
            where: { id: h.id },
            data: {
              costPrice: nuevoCosto,
              salePrice: hNewSale,
            },
          });

          this.logger.log(
            `🎨 Variante sincronizada [Modelo ${modelId}, Color ${h.color}]: Costo $${hCost} -> $${nuevoCosto}, Venta $${hSale} -> $${hNewSale}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Error al sincronizar variantes del modelo ${modelId}: ${err?.message || err}`);
    }
  }
}
