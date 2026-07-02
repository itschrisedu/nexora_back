import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from '../../domain/DomainEvent';

@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  publish(event: DomainEvent): void {
    this.logger.log(`📢 Publicando evento: ${event.eventName}`);
    this.eventEmitter.emit(event.eventName, event);
  }

  publishAll(events: ReadonlyArray<DomainEvent>): void {
    events.forEach((event) => this.publish(event));
  }
}
