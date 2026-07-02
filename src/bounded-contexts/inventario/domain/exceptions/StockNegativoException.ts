import { BadRequestException } from '@nestjs/common';

export class StockNegativoException extends BadRequestException {
  constructor(disponible: number) {
    super(
      `El stock disponible no puede quedar en negativo (disponible: ${disponible})`,
    );
  }
}
