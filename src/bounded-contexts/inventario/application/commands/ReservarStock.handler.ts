import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IProductoRepository } from '../../domain/IProductoRepository';
import { ReservarStockCommand } from './ReservarStock.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';

@Injectable()
export class ReservarStockHandler {
  constructor(
    @Inject('IProductoRepository')
    private readonly productoRepository: IProductoRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: ReservarStockCommand): Promise<string> {
    const producto = await this.productoRepository.findById(command.productoId);
    if (!producto) {
      throw new NotFoundException(`El producto con ID "${command.productoId}" no existe`);
    }

    const reservaId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + command.ttlMinutos * 60 * 1000);

    // Ejecutar lógica de reserva en el aggregate root (valida stock y lanza excepciones)
    producto.reservarStock(command.tallaId, command.cantidad, reservaId, expiresAt);

    // Guardar la reserva física en la BD
    await this.prisma.stockReservation.create({
      data: {
        id: reservaId,
        productId: command.productoId,
        tallaId: command.tallaId,
        cantidad: command.cantidad,
        motivo: command.motivo,
        referenceId: command.referenceId,
        expiresAt,
        cancelada: false,
      },
    });

    // Actualizar el producto agregador (que ahora tiene el stock reservado incrementado)
    await this.productoRepository.update(producto);

    return reservaId;
  }
}
