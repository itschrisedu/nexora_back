import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ICobroRepository } from '../../domain/ICobroRepository';
import { Money } from '../../../../shared/domain/Money';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class RegistrarAbonoHandler {
  constructor(
    @Inject('ICobroRepository') private readonly cobroRepo: ICobroRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: {
    cobroId: string;
    monto: number;
    metodo: string;
    userId: string;
    notas?: string;
  }): Promise<void> {
    const cobro = await this.cobroRepo.findById(command.cobroId);
    if (!cobro) {
      throw new NotFoundException(`Cobro ${command.cobroId} no encontrado`);
    }

    const abonoId = crypto.randomUUID();
    cobro.registrarAbono(
      abonoId,
      Money.create(command.monto),
      command.metodo,
      command.userId,
      command.notas,
    );

    await this.cobroRepo.update(cobro);

    // Publicar eventos de dominio (AbonoRegistrado, DeudaSaldada si aplica)
    this.eventBus.publishAll(cobro.clearDomainEvents());
  }
}
