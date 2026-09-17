import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IProductoRepository } from '../../domain/IProductoRepository';
import { AumentarStockCommand } from './AumentarStock.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { MovimientoTipo } from '@prisma/client';

@Injectable()
export class AumentarStockHandler {
  constructor(
    @Inject('IProductoRepository')
    private readonly productoRepository: IProductoRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: AumentarStockCommand): Promise<void> {
    if (command.cantidad <= 0) return;

    let targetTallaId = command.tallaId;

    // 1. Resolver el producto (por ID directo de Product o por ID de ProductModel)
    let productRecord = await this.prisma.product.findUnique({
      where: { id: command.productoId },
      include: {
        stockByTalla: { include: { talla: true } },
        serie: { include: { tallas: true } },
      },
    });

    let realProductId = command.productoId;

    if (!productRecord) {
      const productByModel = await this.prisma.product.findFirst({
        where: { modelId: command.productoId },
        include: {
          stockByTalla: { include: { talla: true } },
          serie: { include: { tallas: true } },
        },
      });

      if (productByModel) {
        productRecord = productByModel;
        realProductId = productByModel.id;
      } else {
        throw new NotFoundException(`El producto con ID "${command.productoId}" no existe`);
      }
    }

    // 2. Resolver la tallaId exacta en la base de datos
    let matchedTallaId: string | null = null;

    // a) Coincidencia directa en stockByTalla
    const directMatch = productRecord.stockByTalla.find((s) => s.tallaId === targetTallaId);
    if (directMatch) {
      matchedTallaId = directMatch.tallaId;
    }

    // b) Coincidencia por número en stockByTalla
    if (!matchedTallaId) {
      const matchByNum = productRecord.stockByTalla.find(
        (s) => String(s.talla?.numero) === String(targetTallaId),
      );
      if (matchByNum) {
        matchedTallaId = matchByNum.tallaId;
      }
    }

    // c) Coincidencia en la serie del producto
    if (!matchedTallaId && productRecord.serie?.tallas) {
      const matchInSerie = productRecord.serie.tallas.find(
        (t) => String(t.numero) === String(targetTallaId) || t.id === targetTallaId,
      );
      if (matchInSerie) {
        matchedTallaId = matchInSerie.id;
      }
    }

    // d) Búsqueda global en cualquier TallaConfig (por ID o número)
    if (!matchedTallaId) {
      const isNum = !isNaN(Number(targetTallaId));
      const globalTalla = await this.prisma.tallaConfig.findFirst({
        where: isNum
          ? { OR: [{ id: targetTallaId }, { numero: Number(targetTallaId) }] }
          : { id: targetTallaId },
      });
      if (globalTalla) {
        matchedTallaId = globalTalla.id;
      } else if (isNum) {
        const defaultSerie = productRecord.serie || (await this.prisma.seriesConfig.findFirst());
        if (defaultSerie) {
          const nuevaTalla = await this.prisma.tallaConfig.create({
            data: {
              numero: Number(targetTallaId),
              serieId: defaultSerie.id,
            },
          });
          matchedTallaId = nuevaTalla.id;
        }
      }
    }

    targetTallaId = matchedTallaId || targetTallaId;

    // 3. Asegurar que exista la fila en stockByTalla en Prisma
    await this.prisma.stockByTalla.upsert({
      where: {
        productId_tallaId: {
          productId: realProductId,
          tallaId: targetTallaId,
        },
      },
      update: {},
      create: {
        productId: realProductId,
        tallaId: targetTallaId,
        quantity: 0,
        reservedQuantity: 0,
        minStock: 0,
      },
    });

    // 4. Cargar producto del repositorio de dominio
    const producto = await this.productoRepository.findById(realProductId);
    if (!producto) {
      throw new NotFoundException(`El producto con ID "${realProductId}" no existe`);
    }

    // 5. Aumentar stock físico en el aggregate root
    producto.aumentarStock(targetTallaId, command.cantidad);

    // 6. Registrar movimiento de inventario
    await this.prisma.stockMovement.create({
      data: {
        productId: realProductId,
        tallaId: targetTallaId,
        type: MovimientoTipo.ENTRADA_MERCANCIA,
        quantity: command.cantidad,
        reason: command.motivo,
        referenceId: command.referenceId,
        userId: command.userId,
      },
    });

    // 7. Persistir cambios en el agregador
    await this.productoRepository.update(producto);
  }
}
