import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { IDeudaProveedorRepository } from '../../domain/IDeudaProveedorRepository';
import { DeudaProveedor } from '../../domain/DeudaProveedor';
import { Money } from '../../../../shared/domain/Money';
import { CrearDeudaProveedorCommand } from './CrearDeudaProveedor.command';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class CrearDeudaProveedorHandler {
  constructor(
    @Inject('IDeudaProveedorRepository')
    private readonly deudaRepository: IDeudaProveedorRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CrearDeudaProveedorCommand): Promise<string> {
    const existe = await this.deudaRepository.findByEntradaId(command.entradaId);
    if (existe) {
      throw new ConflictException(`Ya existe una cuenta por pagar asociada al ingreso de mercancía "${command.entradaId}"`);
    }

    const deudaId = crypto.randomUUID();
    const deuda = DeudaProveedor.crear(
      deudaId,
      command.supplierId,
      command.entradaId,
      Money.create(command.montoTotal),
      command.fechaVencimiento,
    );

    await this.deudaRepository.save(deuda);

    // Publicar eventos (DeudaProveedorCreada)
    this.eventBus.publishAll(deuda.clearDomainEvents());

    return deuda.id;
  }
}
