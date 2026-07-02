import { ValueObject } from '../../../../shared/domain/ValueObject';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

export class NivelCredito extends ValueObject<{ value: PrismaNivelCredito }> {
  private static readonly weights: Record<PrismaNivelCredito, number> = {
    [PrismaNivelCredito.SIN_CREDITO]: 0,
    [PrismaNivelCredito.NIVEL_1]: 1,
    [PrismaNivelCredito.NIVEL_2]: 2,
    [PrismaNivelCredito.NIVEL_3]: 3,
    [PrismaNivelCredito.NIVEL_4]: 4,
  };

  private constructor(value: PrismaNivelCredito) {
    super({ value });
  }

  static create(value: PrismaNivelCredito): NivelCredito {
    return new NivelCredito(value);
  }

  get value(): PrismaNivelCredito {
    return this.props.value;
  }

  get weight(): number {
    return NivelCredito.weights[this.props.value];
  }

  nivelInferior(): NivelCredito {
    switch (this.props.value) {
      case PrismaNivelCredito.NIVEL_4:
        return new NivelCredito(PrismaNivelCredito.NIVEL_3);
      case PrismaNivelCredito.NIVEL_3:
        return new NivelCredito(PrismaNivelCredito.NIVEL_2);
      case PrismaNivelCredito.NIVEL_2:
        return new NivelCredito(PrismaNivelCredito.NIVEL_1);
      default:
        return new NivelCredito(PrismaNivelCredito.SIN_CREDITO);
    }
  }

  esMenorQue(otro: NivelCredito): boolean {
    return this.weight < otro.weight;
  }

  static sinCredito(): NivelCredito {
    return new NivelCredito(PrismaNivelCredito.SIN_CREDITO);
  }
}
