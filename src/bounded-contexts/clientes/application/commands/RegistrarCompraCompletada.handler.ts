import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IClienteRepository } from '../../domain/IClienteRepository';
import { RegistrarCompraCompletadaCommand } from './RegistrarCompraCompletada.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { Money } from '../../../../shared/domain/Money';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class RegistrarCompraCompletadaHandler {
  constructor(
    @Inject('IClienteRepository')
    private readonly clienteRepository: IClienteRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: RegistrarCompraCompletadaCommand): Promise<void> {
    const cliente = await this.clienteRepository.findById(command.clienteId);
    if (!cliente) {
      throw new NotFoundException(`El cliente con ID "${command.clienteId}" no existe`);
    }

    // Obtener configuraciones de niveles de crédito
    const configs = await this.prisma.creditLevelConfig.findMany();

    const nivelAnterior = cliente.nivelCredito.value;

    cliente.registrarCompraCompletada(
      Money.create(command.monto),
      command.esCredito,
      configs.map((c) => ({
        nivel: c.nivel,
        comprasRequeridas: c.comprasRequeridas,
        limiteDolares: Number(c.limiteDolares),
      })),
    );

    await this.clienteRepository.update(cliente);

    const nivelNuevo = cliente.nivelCredito.value;

    // Si cambió el nivel de crédito, registrar en historial
    if (nivelAnterior !== nivelNuevo) {
      await this.prisma.creditScoreHistory.create({
        data: {
          clientId: cliente.id,
          nivelAnterior,
          nivelNuevo,
          motivo: 'COMPRA_COMPLETADA',
        },
      });
    }

    // Publicar eventos
    this.eventBus.publishAll(cliente.clearDomainEvents());
  }
}

