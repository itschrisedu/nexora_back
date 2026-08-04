import { ValueObject } from '../../../../shared/domain/ValueObject';

export class Serie extends ValueObject<string> {
  private constructor(value: string) {
    super(value);
  }

  /**
   * Crea una serie de calzado.
   * Ya no se valida contra lista fija — cualquier nombre es válido
   * siempre que exista en la BD (la validación se hace en el handler/service).
   */
  static create(value: string): Serie {
    const upperValue = value.toUpperCase().trim();
    if (!upperValue) {
      throw new Error('El nombre de la serie no puede estar vacío');
    }
    return new Serie(upperValue);
  }

  get value(): string {
    return this.props;
  }
}
