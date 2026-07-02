import { ValueObject } from '../../../../shared/domain/ValueObject';
import { TipoPago as PrismaTipoPago } from '@prisma/client';

export class TipoPago extends ValueObject<{ value: PrismaTipoPago }> {
  constructor(value: PrismaTipoPago) {
    super({ value });
  }

  static create(value: PrismaTipoPago): TipoPago {
    return new TipoPago(value);
  }

  get value(): PrismaTipoPago {
    return this.props.value;
  }
}
