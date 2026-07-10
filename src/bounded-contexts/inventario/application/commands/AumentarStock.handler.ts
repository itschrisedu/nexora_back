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
    const producto = await this.productoRepository.findById(command.productoId);
    if (!producto) {
      throw new NotFoundException(`El producto con ID "${command.productoId}" no existe`);
    }

    // Aumentar físico en el aggregate root (emite evento si vuelve a estar disponible)
    producto.aumentarStock(command.tallaId, command.cantidad);

    // Guardar el movimiento físico
    await this.prisma.stockMovement.create({
      data: {
        productId: command.productoId,
        tallaId: command.tallaId,
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
