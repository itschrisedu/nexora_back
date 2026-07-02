import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IProductoRepository } from '../../domain/IProductoRepository';
import { CambiarPrecioCommand } from './CambiarPrecio.command';
import { Money } from '../../../../shared/domain/Money';

@Injectable()
export class CambiarPrecioHandler {
  constructor(
    @Inject('IProductoRepository')
    private readonly productoRepository: IProductoRepository,
  ) {}

  async execute(command: CambiarPrecioCommand): Promise<void> {
    const producto = await this.productoRepository.findById(command.productoId);
    if (!producto) {
      throw new NotFoundException(`El producto con ID "${command.productoId}" no existe`);
    }

    producto.cambiarPrecio(
      Money.create(command.nuevoPrecioCosto),
      Money.create(command.nuevoPrecioVenta),
      command.userId,
      command.motivo,
    );

    await this.productoRepository.update(producto);
  }
}
