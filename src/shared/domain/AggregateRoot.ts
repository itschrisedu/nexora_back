import { DomainEvent } from './DomainEvent';

/**
 * AggregateRoot — Clase base para todos los aggregates de NEXORA.
 * Acumula eventos de dominio que se publican después de persistir.
 */
export abstract class AggregateRoot {
  private _domainEvents: DomainEvent[] = [];

  get domainEvents(): ReadonlyArray<DomainEvent> {
    return [...this._domainEvents];
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  clearDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }
}
