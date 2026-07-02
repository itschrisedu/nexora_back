import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { IniciarPreparacionCommand } from './IniciarPreparacion.command';
import { PermisoInsuficienteException } from '../../../clientes/domain/exceptions/ClienteExceptions';

@Injectable()
export class IniciarPreparacionHandler {
  constructor(
    @Inject('IPedidoRepository')
    private readonly pedidoRepository: IPedidoRepository,
  ) {}

  async execute(command: IniciarPreparacionCommand): Promise<void> {
    if (command.rol !== 'ROL_ADMIN' && command.rol !== 'ROL_BODEGUERO') {
      throw new PermisoInsuficienteException(
        'El inicio de preparación de pedidos solo está permitido para administradores y bodegueros',
      );
    }

    const pedido = await this.pedidoRepository.findById(command.pedidoId);
    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${command.pedidoId}" no existe`);
    }

    pedido.iniciarPreparacion();

    await this.pedidoRepository.update(pedido);
  }
}
