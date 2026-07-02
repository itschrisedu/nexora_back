/**
 * DomainEvent — Clase base para todos los eventos de dominio en NEXORA.
 * Cada evento captura un hecho significativo que ocurrió en el sistema.
 */
export abstract class DomainEvent {
  public readonly occurredOn: Date;
  public readonly eventName: string;

  protected constructor(eventName: string) {
    this.occurredOn = new Date();
    this.eventName = eventName;
  }

  abstract toPrimitives(): Record<string, unknown>;
}
