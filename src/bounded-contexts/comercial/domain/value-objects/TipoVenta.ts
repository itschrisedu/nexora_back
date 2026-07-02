import { ValueObject } from '../../../../shared/domain/ValueObject';
import { TipoVenta as PrismaTipoVenta } from '@prisma/client';
export { TipoVenta as PrismaTipoVenta } from '@prisma/client';

export class TipoVenta extends ValueObject<{ value: PrismaTipoVenta }> {
  constructor(value: PrismaTipoVenta) {
    super({ value });
  }

  static create(value: PrismaTipoVenta): TipoVenta {
    return new TipoVenta(value);
  }

  get value(): PrismaTipoVenta {
    return this.props.value;
  }
}
