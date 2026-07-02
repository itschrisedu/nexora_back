import { BadRequestException } from '@nestjs/common';

export class SerieInvalidaException extends BadRequestException {
  constructor(valor: string, seriesValidas: string[]) {
    super(
      `La serie "${valor}" es inválida. Valores permitidos: ${seriesValidas.join(', ')}`,
    );
  }
}
