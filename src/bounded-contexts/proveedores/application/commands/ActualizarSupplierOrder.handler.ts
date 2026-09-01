import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ISupplierOrderRepository } from '../../domain/ISupplierOrderRepository';
import { ActualizarSupplierOrderCommand } from './ActualizarSupplierOrder.command';
import { SupplierOrderStatus } from '@prisma/client';

@Injectable()
export class ActualizarSupplierOrderHandler {
  constructor(
    @Inject('ISupplierOrderRepository')
    private readonly orderRepository: ISupplierOrderRepository,
  ) {}

  async execute(command: ActualizarSupplierOrderCommand): Promise<void> {
    const order = await this.orderRepository.findById(command.orderId);
    if (!order) {
      throw new NotFoundException(`Orden de compra con ID "${command.orderId}" no encontrada.`);
    }

    if (order.estado === SupplierOrderStatus.RECIBIDA || order.estado === SupplierOrderStatus.RECIBIDA_PARCIAL) {
      throw new BadRequestException('No se puede modificar una orden que ya ha sido recibida.');
    }

    if (command.lines && command.lines.length > 0) {
      order.actualizar(
        command.lines.map((l) => ({
          id: crypto.randomUUID(),
          productId: l.productId,
          cantidadPedida: l.cantidadPedida,
          precioCosto: l.precioCosto,
          observacionLinea: l.observacionLinea,
        })),
        command.observaciones !== undefined ? command.observaciones : order.observaciones,
      );
    } else if (command.observaciones !== undefined) {
      order.actualizar(
        order.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          cantidadPedida: l.cantidadPedida,
          precioCosto: l.precioCosto,
          observacionLinea: l.observacionLinea,
        })),
        command.observaciones,
      );
    }

    if (command.estado === 'PENDIENTE' && order.estado === SupplierOrderStatus.BORRADOR) {
      order.confirmarEnvio();
    } else if (command.estado === 'CANCELADA') {
      order.cancelar();
    }

    await this.orderRepository.update(order);
  }
}
