import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { IDeudaProveedorRepository } from '../../domain/IDeudaProveedorRepository';
import { DeudaProveedor } from '../../domain/DeudaProveedor';
import { Money } from '../../../../shared/domain/Money';
import { CrearDeudaProveedorCommand } from './CrearDeudaProveedor.command';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';

@Injectable()
export class CrearDeudaProveedorHandler {
  constructor(
    @Inject('IDeudaProveedorRepository')
    private readonly deudaRepository: IDeudaProveedorRepository,
    private readonly eventBus: EventBus,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: CrearDeudaProveedorCommand): Promise<string> {
    const existe = await this.deudaRepository.findByEntradaId(command.entradaId);
    if (existe) {
      throw new ConflictException(`Ya existe una cuenta por pagar asociada al ingreso de mercancía "${command.entradaId}"`);
    }

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: command.supplierId },
    });
    if (!supplier) {
      throw new ConflictException(`Proveedor con ID "${command.supplierId}" no encontrado`);
    }

    const deudaId = crypto.randomUUID();
    const deuda = DeudaProveedor.crear(
      deudaId,
      command.supplierId,
      command.entradaId,
      Money.create(command.montoTotal),
      command.fechaVencimiento,
    );

    await this.deudaRepository.save(deuda, supplier.tenantId);

    // Publicar eventos (DeudaProveedorCreada)
    this.eventBus.publishAll(deuda.clearDomainEvents());

    return deuda.id;
  }
}
