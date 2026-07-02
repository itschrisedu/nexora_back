import { ValueObject } from '../../../../shared/domain/ValueObject';
import { BadRequestException } from '@nestjs/common';

export type TipoVentaValores = 'SERIE_COMPLETA' | 'TALLA_ESPECIFICA';

export class TipoVenta extends ValueObject<TipoVentaValores> {
  private constructor(value: TipoVentaValores) {
    super(value);
  }

  static create(value: string): TipoVenta {
    const upperValue = value.toUpperCase();
    if (upperValue !== 'SERIE_COMPLETA' && upperValue !== 'TALLA_ESPECIFICA') {
      throw new BadRequestException(
        `TipoVenta inválido: "${value}". Permitidos: SERIE_COMPLETA, TALLA_ESPECIFICA`,
      );
    }
    return new TipoVenta(upperValue as TipoVentaValores);
  }

  get value(): TipoVentaValores {
    return this.props;
  }
}
