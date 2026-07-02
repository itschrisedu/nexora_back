/**
 * Entity — Clase base para entidades en NEXORA.
 * Identificadas por su ID único (no por sus atributos).
 */
export abstract class Entity<T> {
  protected readonly _id: string;
  protected readonly props: T;

  protected constructor(id: string, props: T) {
    this._id = id;
    this.props = props;
  }

  get id(): string {
    return this._id;
  }

  equals(other: Entity<T>): boolean {
    if (other === null || other === undefined) return false;
    if (other.constructor !== this.constructor) return false;
    return this.id === other.id;
  }
}
