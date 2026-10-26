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
}
