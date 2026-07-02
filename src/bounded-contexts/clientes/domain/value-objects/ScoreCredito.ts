import { ValueObject } from '../../../../shared/domain/ValueObject';
import { NivelCredito } from './NivelCredito';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

export interface ScoreCreditoProps {
  totalCompras: number;
  comprasSinAtraso: number;
  atrasoConsecutivo: number;
  nivelActual: NivelCredito;
}

export class ScoreCredito extends ValueObject<ScoreCreditoProps> {
  private constructor(props: ScoreCreditoProps) {
    super(props);
  }

  static create(
    totalCompras: number,
    comprasSinAtraso: number,
    atrasoConsecutivo: number,
    nivelActual: NivelCredito,
  ): ScoreCredito {
    return new ScoreCredito({
      totalCompras,
      comprasSinAtraso,
      atrasoConsecutivo,
      nivelActual,
    });
  }

  get totalCompras(): number {
    return this.props.totalCompras;
  }

  get comprasSinAtraso(): number {
    return this.props.comprasSinAtraso;
  }

  get atrasoConsecutivo(): number {
    return this.props.atrasoConsecutivo;
  }

  get nivelActual(): NivelCredito {
    return this.props.nivelActual;
  }

  calcularNivelElegible(configs: { nivel: PrismaNivelCredito; comprasRequeridas: number }[]): NivelCredito {
    // Ordenar configuraciones de mayor a menor compras requeridas
    const sorted = [...configs].sort((a, b) => b.comprasRequeridas - a.comprasRequeridas);

    for (const conf of sorted) {
      if (
        this.totalCompras >= conf.comprasRequeridas &&
        this.comprasSinAtraso >= conf.comprasRequeridas
      ) {
        return NivelCredito.create(conf.nivel);
      }
    }

    return NivelCredito.sinCredito();
  }

  puedeSubirDeNivel(
    configs: { nivel: PrismaNivelCredito; comprasRequeridas: number }[],
  ): boolean {
    const nivelElegible = this.calcularNivelElegible(configs);
    return this.nivelActual.esMenorQue(nivelElegible);
  }
}
