import { BadRequestException } from '@nestjs/common';

export class ReservaSuperaStockException extends BadRequestException {
  constructor(
    reserva: number,
    stock: number,
    modelo?: string,
    talla?: number | string,
  ) {
    let detalle = '';
    if (modelo) {
      detalle += ` en el modelo "${modelo}"`;
    }
    if (talla) {
      detalle += ` (Talla ${talla})`;
    }
    super(
      `La cantidad reservada (${reserva}) no puede superar el stock físico total disponible (${stock})${detalle}`,
    );
  }
}
