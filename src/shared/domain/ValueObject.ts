/**
 * ValueObject — Clase base para Value Objects en NEXORA.
 * Comparación por valor (no por referencia). Inmutable.
 */
export abstract class ValueObject<T> {
  protected readonly props: T;

  protected constructor(props: T) {
    this.props = Object.freeze(props);
  }

  equals(other: ValueObject<T>): boolean {
    if (other === null || other === undefined) return false;
    if (other.constructor !== this.constructor) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }

  toValue(): T {
    return this.props;
  }
}
