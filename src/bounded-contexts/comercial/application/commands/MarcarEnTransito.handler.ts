import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { MarcarEnTransitoCommand } from './MarcarEnTransito.command';

@Injectable()
export class MarcarEnTransitoHandler {
  constructor(
    @Inject('IPedidoRepository')
    private readonly pedidoRepository: IPedidoRepository,
  ) {}

  async execute(command: MarcarEnTransitoCommand): Promise<void> {
    const pedido = await this.pedidoRepository.findById(command.pedidoId);
    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${command.pedidoId}" no existe`);
    }

    pedido.marcarEnTransito();

    await this.pedidoRepository.update(pedido);
  }
}
