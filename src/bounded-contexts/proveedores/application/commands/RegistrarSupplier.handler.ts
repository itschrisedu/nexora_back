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
    let rucCifrado: string;

    if (command.ruc && command.ruc.trim() !== '') {
      const rucLimpio = command.ruc.trim();
      // 1. Validar que el RUC/Cédula en claro tenga 10 o 13 dígitos numéricos
      if (!/^\d{10}(\d{3})?$/.test(rucLimpio)) {
        throw new BadRequestException(`El documento "${command.ruc}" no es válido. Debe tener 10 dígitos (cédula) o 13 dígitos (RUC).`);
      }

      // 2. Cifrar el RUC para persistencia e invariante de unicidad
      rucCifrado = this.encryptionService.encrypt(rucLimpio);

      // 3. Validar duplicado por RUC (cifrado) en esta sucursal
      const existe = await this.supplierRepository.findByRuc(rucCifrado, command.tenantId);
      if (existe) {
        throw new ConflictException(`Ya existe un proveedor registrado con el RUC/Cédula "${command.ruc}" en esta sucursal.`);
      }
    } else {
      // Si no se proporciona RUC, generamos un identificador único seguro cifrado para cumplir la restricción única de BD
      const placeholder = `PROV-${crypto.randomUUID().slice(0, 8)}`;
      rucCifrado = this.encryptionService.encrypt(placeholder);
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
