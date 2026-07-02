import { BadRequestException } from '@nestjs/common';

export class ReservaSuperaStockException extends BadRequestException {
  constructor(reserva: number, stock: number) {
    super(
      `La cantidad reservada (${reserva}) no puede superar el stock físico total disponible (${stock})`,
    );
  }
}
