import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { IProductoRepository } from '../../domain/IProductoRepository';
import { LiberarReservaCommand } from './LiberarReserva.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';

@Injectable()
export class LiberarReservaHandler {
  constructor(
    @Inject('IProductoRepository')
    private readonly productoRepository: IProductoRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: LiberarReservaCommand): Promise<void> {
    const reservation = await this.prisma.stockReservation.findUnique({
      where: { id: command.reservaId },
    });

    if (!reservation) {
      throw new NotFoundException(`La reserva con ID "${command.reservaId}" no existe`);
    }

    if (reservation.cancelada) {
      throw new BadRequestException(`La reserva con ID "${command.reservaId}" ya fue liberada`);
    }

    const producto = await this.productoRepository.findById(reservation.productId);
    if (!producto) {
      throw new NotFoundException(`El producto con ID "${reservation.productId}" no existe`);
    }

    // Ejecutar lógica en el aggregate root
    producto.liberarReserva(reservation.tallaId, reservation.cantidad, reservation.id);

    // Marcar la reserva como cancelada en la BD
    await this.prisma.stockReservation.update({
      where: { id: reservation.id },
      data: { cancelada: true },
    });

    // Actualizar el producto agregador
    await this.productoRepository.update(producto);
  }
}
