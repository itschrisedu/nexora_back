import { BadRequestException } from '@nestjs/common';

export class StockNegativoException extends BadRequestException {
  constructor(
    disponible: number,
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
      `El stock disponible no puede quedar en negativo (${disponible})${detalle}`,
    );
  }
}
