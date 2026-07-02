import { BadRequestException } from '@nestjs/common';

export class TallaInvalidaParaSerieException extends BadRequestException {
  constructor(talla: number, serie: string, rango: string) {
    super(
      `La talla ${talla} es inválida para la serie "${serie}". Rango permitido: ${rango}`,
    );
  }
}
