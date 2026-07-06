import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IDeudaProveedorRepository } from '../../domain/IDeudaProveedorRepository';
import { Money } from '../../../../shared/domain/Money';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class RegistrarPagoProveedorHandler {
  constructor(
    @Inject('IDeudaProveedorRepository') private readonly deudaRepo: IDeudaProveedorRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: {
    deudaId: string;
    monto: number;
    metodo: string;
    userId: string;
    notas?: string;
  }): Promise<void> {
    const deuda = await this.deudaRepo.findById(command.deudaId);
    if (!deuda) {
      throw new NotFoundException(`Deuda de proveedor ${command.deudaId} no encontrada`);
    }

    const pagoId = crypto.randomUUID();
    deuda.registrarPago(
      pagoId,
      Money.create(command.monto),
      command.metodo,
      command.userId,
      command.notas,
    );

    await this.deudaRepo.update(deuda);

    // Publicar eventos de dominio (PagoProveedorRegistrado, DeudaProveedorSaldada si aplica)
    this.eventBus.publishAll(deuda.clearDomainEvents());
  }
}
