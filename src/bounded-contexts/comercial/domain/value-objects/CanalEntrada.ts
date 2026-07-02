import { ValueObject } from '../../../../shared/domain/ValueObject';
import { CanalEntrada as PrismaCanalEntrada } from '@prisma/client';

export class CanalEntrada extends ValueObject<{ value: PrismaCanalEntrada }> {
  constructor(value: PrismaCanalEntrada) {
    super({ value });
  }

  static create(value: PrismaCanalEntrada): CanalEntrada {
    return new CanalEntrada(value);
  }

  get value(): PrismaCanalEntrada {
    return this.props.value;
  }
}
