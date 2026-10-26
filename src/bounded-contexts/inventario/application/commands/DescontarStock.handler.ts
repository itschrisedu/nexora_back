import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IProductoRepository } from '../../domain/IProductoRepository';
import { DescontarStockCommand } from './DescontarStock.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { MovimientoTipo } from '@prisma/client';
import { FifoInventoryService } from '../services/FifoInventoryService';

@Injectable()
export class DescontarStockHandler {
  constructor(
    @Inject('IProductoRepository')
    private readonly productoRepository: IProductoRepository,
    private readonly prisma: PrismaService,
    private readonly fifoService: FifoInventoryService,
  ) {}

  async execute(command: DescontarStockCommand): Promise<void> {
    const producto = await this.productoRepository.findById(command.productoId);
    if (!producto) {
      throw new NotFoundException(`El producto con ID "${command.productoId}" no existe`);
    }

    // Ejecutar lógica en el aggregate root (disminuir físico y validar stock)
    producto.descontarStock(command.tallaId, command.cantidad);

    // Guardar el movimiento físico
    await this.prisma.stockMovement.create({
      data: {
        productId: command.productoId,
        tallaId: command.tallaId,
        type: MovimientoTipo.VENTA,
        quantity: -command.cantidad,
        reason: command.motivo,
        referenceId: command.referenceId,
        userId: command.userId,
      },
    });

    // Descontar del lote FIFO más antiguo vigente
    await this.fifoService.descontarStockFifo({
      productId: command.productoId,
      tallaId: command.tallaId,
      cantidad: command.cantidad,
    });

    // Actualizar el agregador
    await this.productoRepository.update(producto);
  }
}
