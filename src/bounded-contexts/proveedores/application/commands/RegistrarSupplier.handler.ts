import { Inject, Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { ISupplierRepository } from '../../domain/ISupplierRepository';
import { Supplier } from '../../domain/Supplier';
import { RegistrarSupplierCommand } from './RegistrarSupplier.command';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class RegistrarSupplierHandler {
  constructor(
    @Inject('ISupplierRepository')
    private readonly supplierRepository: ISupplierRepository,
    private readonly encryptionService: EncryptionService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: RegistrarSupplierCommand): Promise<string> {
    // 1. Validar que el RUC en claro tenga 13 dígitos numéricos
    if (!/^\d{13}$/.test(command.ruc)) {
      throw new BadRequestException(`El RUC "${command.ruc}" no es válido. Debe tener exactamente 13 dígitos numéricos.`);
    }

    // 2. Cifrar el RUC para persistencia e invariante de unicidad
    const rucCifrado = this.encryptionService.encrypt(command.ruc);

    // 3. Validar duplicado por RUC (cifrado)
    const existe = await this.supplierRepository.findByRuc(rucCifrado);
    if (existe) {
      throw new ConflictException(`Ya existe un proveedor registrado con el RUC "${command.ruc}"`);
    }

    const supplierId = crypto.randomUUID();
    const supplier = Supplier.crear(
      supplierId,
      rucCifrado,
      command.razonSocial,
      command.contacto,
      command.direccion,
      command.email,
    );

    await this.supplierRepository.save(supplier, command.tenantId);

    // Publicar eventos
    this.eventBus.publishAll(supplier.clearDomainEvents());

    return supplier.id;
  }
}
