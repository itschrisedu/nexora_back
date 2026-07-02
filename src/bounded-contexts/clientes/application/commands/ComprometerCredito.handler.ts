import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IClienteRepository } from '../../domain/IClienteRepository';
import { ComprometerCreditoCommand } from './ComprometerCredito.command';
import { Money } from '../../../../shared/domain/Money';

@Injectable()
export class ComprometerCreditoHandler {
  constructor(
    @Inject('IClienteRepository')
    private readonly clienteRepository: IClienteRepository,
  ) {}

  async execute(command: ComprometerCreditoCommand): Promise<void> {
    const cliente = await this.clienteRepository.findById(command.clienteId);
    if (!cliente) {
      throw new NotFoundException(`El cliente con ID "${command.clienteId}" no existe`);
    }

    cliente.comprometerCredito(Money.create(command.monto));

    await this.clienteRepository.update(cliente);
  }
}
