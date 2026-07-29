import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { IClienteRepository } from '../../domain/IClienteRepository';
import { Cliente } from '../../domain/Cliente';
import { RegistrarClienteCommand } from './RegistrarCliente.command';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class RegistrarClienteHandler {
  constructor(
    @Inject('IClienteRepository')
    private readonly clienteRepository: IClienteRepository,
    private readonly encryptionService: EncryptionService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: RegistrarClienteCommand): Promise<string> {
    // Validar duplicado por teléfono
    const existe = await this.clienteRepository.findByTelefono(command.telefono);
    if (existe) {
      throw new ConflictException(`Ya existe un cliente registrado con el teléfono "${command.telefono}"`);
    }

    // Cifrar RUC y Cédula de manera segura si vienen informados
    const rucCifrado = command.ruc ? this.encryptionService.encrypt(command.ruc) : null;
    const cedulaCifrada = command.cedula ? this.encryptionService.encrypt(command.cedula) : null;

    const clienteId = crypto.randomUUID();
    const cliente = Cliente.crear(
      clienteId,
      command.nombre,
      command.apellido,
      command.telefono,
      command.email,
      rucCifrado,
      cedulaCifrada,
      command.direccion,
      command.notas,
    );

    await this.clienteRepository.save(cliente, command.tenantId);

    // Publicar eventos
    this.eventBus.publishAll(cliente.clearDomainEvents());

    return cliente.id;
  }
}

