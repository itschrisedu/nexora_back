import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IClienteRepository } from '../../domain/IClienteRepository';
import { ActualizarClienteCommand } from './ActualizarCliente.command';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';

@Injectable()
export class ActualizarClienteHandler {
  constructor(
    @Inject('IClienteRepository')
    private readonly clienteRepository: IClienteRepository,
    private readonly encryptionService: EncryptionService,
  ) {}

  async execute(command: ActualizarClienteCommand): Promise<void> {
    const cliente = await this.clienteRepository.findById(command.id);
    if (!cliente) {
      throw new NotFoundException(`El cliente con ID "${command.id}" no existe`);
    }

    // Cifrar RUC y Cédula de manera segura si vienen informados
    const rucCifrado = command.ruc ? this.encryptionService.encrypt(command.ruc) : null;
    const cedulaCifrada = command.cedula ? this.encryptionService.encrypt(command.cedula) : null;

    cliente.actualizarDatosPersonales(
      command.nombre,
      command.apellido,
      command.telefono,
      command.email,
      rucCifrado,
      cedulaCifrada,
      command.direccion,
      command.notas,
    );

    await this.clienteRepository.update(cliente);
  }
}
