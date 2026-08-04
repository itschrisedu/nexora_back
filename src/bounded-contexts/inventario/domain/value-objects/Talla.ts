import { ValueObject } from '../../../../shared/domain/ValueObject';
import { Serie } from './Serie';

interface TallaProps {
  numero: number;
  serie: Serie;
}

export class Talla extends ValueObject<TallaProps> {
  private constructor(props: TallaProps) {
    super(props);
  }

  /**
   * Crea una talla de calzado.
   * La validación de rango ya no es hardcodeada — se valida contra las tallas
   * configuradas en la BD para cada serie.
   * Solo se verifica que el número sea positivo.
   */
  static create(numero: number, serie: Serie): Talla {
    if (numero < 1) {
      throw new Error(`El número de talla debe ser mayor a 0, recibido: ${numero}`);
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
