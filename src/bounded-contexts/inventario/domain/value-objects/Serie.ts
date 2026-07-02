import { ValueObject } from '../../../../shared/domain/ValueObject';
import { SerieInvalidaException } from '../exceptions/SerieInvalidaException';

export const SERIES_VALIDAS = [
  'BEBE',
  'NINO_PEQUENO_A',
  'NINO_PEQUENO_B',
  'NINO',
  'JUVENIL',
  'ADULTO',
  'TALLA_GRANDE',
];

export class Serie extends ValueObject<string> {
  private constructor(value: string) {
    super(value);
  }

  static create(value: string): Serie {
    const upperValue = value.toUpperCase();
    if (!SERIES_VALIDAS.includes(upperValue)) {
      throw new SerieInvalidaException(value, SERIES_VALIDAS);
    }
    return new Serie(upperValue);
  }

  get value(): string {
    return this.props;
  }
}
