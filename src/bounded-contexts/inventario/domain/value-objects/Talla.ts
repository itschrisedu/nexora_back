import { ValueObject } from '../../../../shared/domain/ValueObject';
import { TallaInvalidaParaSerieException } from '../exceptions/TallaInvalidaParaSerieException';
import { Serie } from './Serie';

interface TallaProps {
  numero: number;
  serie: Serie;
}

export const RANGOS_SERIE: Record<string, { min: number; max: number }> = {
  BEBE: { min: 18, max: 20 },
  NINO_PEQUENO_A: { min: 21, max: 26 },
  NINO_PEQUENO_B: { min: 21, max: 26 },
  NINO: { min: 27, max: 32 },
  JUVENIL: { min: 34, max: 38 },
  ADULTO: { min: 38, max: 43 },
  TALLA_GRANDE: { min: 43, max: 45 },
};

export class Talla extends ValueObject<TallaProps> {
  private constructor(props: TallaProps) {
    super(props);
  }

  static create(numero: number, serie: Serie): Talla {
    const rango = RANGOS_SERIE[serie.value];
    if (!rango) {
      throw new Error(`Rango de serie no configurado para: ${serie.value}`);
    }

    if (numero < rango.min || numero > rango.max) {
      throw new TallaInvalidaParaSerieException(
        numero,
        serie.value,
        `${rango.min}-${rango.max}`,
      );
    }

    return new Talla({ numero, serie });
  }

  get numero(): number {
    return this.props.numero;
  }

  get serie(): Serie {
    return this.props.serie;
  }
}
