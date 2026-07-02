import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IClienteRepository } from '../../domain/IClienteRepository';
import { RegistrarAtrasoCommand } from './RegistrarAtraso.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class RegistrarAtrasoHandler {
  constructor(
    @Inject('IClienteRepository')
    private readonly clienteRepository: IClienteRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: RegistrarAtrasoCommand): Promise<void> {
    const cliente = await this.clienteRepository.findById(command.clienteId);
    if (!cliente) {
      throw new NotFoundException(`El cliente con ID "${command.clienteId}" no existe`);
    }

    const configs = await this.prisma.creditLevelConfig.findMany();
    const nivelAnterior = cliente.nivelCredito.value;

    cliente.registrarAtraso(
      configs.map((c) => ({
        nivel: c.nivel,
        comprasRequeridas: c.comprasRequeridas,
        limiteDolares: Number(c.limiteDolares),
      })),
    );

    await this.clienteRepository.update(cliente);

    const nivelNuevo = cliente.nivelCredito.value;

    if (nivelAnterior !== nivelNuevo) {
      const motivo = cliente.atrasoConsecutivo >= 2 ? 'DOS_ATRASOS_CONSECUTIVOS' : 'ATRASO';
      await this.prisma.creditScoreHistory.create({
        data: {
          clientId: cliente.id,
          nivelAnterior,
          nivelNuevo,
          motivo,
        },
      });
    }

    // Publicar eventos
    this.eventBus.publishAll(cliente.clearDomainEvents());
  }
}

