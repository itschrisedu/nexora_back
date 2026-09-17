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

    // Verificar y resolver la tallaId en la base de datos
    const productRecord = await this.prisma.product.findUnique({
      where: { id: command.productoId },
      include: {
        stockByTalla: { include: { talla: true } },
        serie: { include: { tallas: true } },
      },
    });

    if (!productRecord) {
      throw new NotFoundException(`El producto con ID "${command.productoId}" no existe`);
    }

    const directMatch = productRecord.stockByTalla.find((s) => s.tallaId === targetTallaId);
    if (!directMatch) {
      const matchByNum = productRecord.stockByTalla.find(
        (s) => String(s.talla?.numero) === String(targetTallaId)
      );
      if (matchByNum) {
        targetTallaId = matchByNum.tallaId;
      } else {
        const matchInSerie = productRecord.serie?.tallas?.find(
          (t) => String(t.numero) === String(targetTallaId) || t.id === targetTallaId
        );
        if (matchInSerie) {
          targetTallaId = matchInSerie.id;
          await this.prisma.stockByTalla.upsert({
            where: {
              productId_tallaId: {
                productId: command.productoId,
                tallaId: matchInSerie.id,
              },
            },
            update: {},
            create: {
              productId: command.productoId,
              tallaId: matchInSerie.id,
              quantity: 0,
              reservedQuantity: 0,
              minStock: 0,
            },
          });
        }
      }
    }

    const producto = await this.productoRepository.findById(command.productoId);
    if (!producto) {
      throw new NotFoundException(`El producto con ID "${command.productoId}" no existe`);
    }

    // Aumentar físico en el aggregate root (emite evento si vuelve a estar disponible)
    producto.aumentarStock(targetTallaId, command.cantidad);

    // Guardar el movimiento físico
    await this.prisma.stockMovement.create({
      data: {
        productId: command.productoId,
        tallaId: targetTallaId,
        type: MovimientoTipo.ENTRADA_MERCANCIA,
        quantity: command.cantidad,
        reason: command.motivo,
        referenceId: command.referenceId,
        userId: command.userId,
      },
    });

    // Actualizar el agregador
    await this.productoRepository.update(producto);
  }
}
