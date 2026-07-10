import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { IOrderQueueRepository } from '../../domain/IOrderQueueRepository';
import { CancelarPedidoCommand } from './CancelarPedido.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { LiberarReservaHandler } from '../../../inventario/application/commands/LiberarReserva.handler';
import { LiberarReservaCommand } from '../../../inventario/application/commands/LiberarReserva.command';
import { LiberarCreditoHandler } from '../../../clientes/application/commands/LiberarCredito.handler';
import { LiberarCreditoCommand } from '../../../clientes/application/commands/LiberarCredito.command';
import { EstadoPedido as PrismaEstadoPedido } from '@prisma/client';

@Injectable()
export class CancelarPedidoHandler {
  constructor(
    @Inject('IPedidoRepository')
    private readonly pedidoRepository: IPedidoRepository,
    @Inject('IOrderQueueRepository')
    private readonly queueRepository: IOrderQueueRepository,
    private readonly prisma: PrismaService,
    private readonly liberarReservaHandler: LiberarReservaHandler,
    private readonly liberarCreditoHandler: LiberarCreditoHandler,
  ) {}

  async execute(command: CancelarPedidoCommand): Promise<void> {
    const pedido = await this.pedidoRepository.findById(command.pedidoId);
    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${command.pedidoId}" no existe`);
    }

    const estadoAnterior = pedido.estado.value;

    // Cambiar estado a CANCELADO en el aggregate root (valida transiciones)
    pedido.cancelar(command.motivo);

    // 1. Si estaba PENDIENTE (o en preparación/tránsito), liberar reservas de inventario
    if (
      estadoAnterior === PrismaEstadoPedido.PENDIENTE ||
      estadoAnterior === PrismaEstadoPedido.EN_PREPARACION ||
      estadoAnterior === PrismaEstadoPedido.EN_TRANSITO ||
      estadoAnterior === PrismaEstadoPedido.MODIFICADO
    ) {
      // Buscar reservas activas vinculadas a este pedido en la base de datos
      const reservas = await this.prisma.stockReservation.findMany({
        where: {
          productId: { in: pedido.lineas.map((l) => l.productId) },
          referenceId: pedido.id,
          canceled: false,
        },
      });

      for (const res of reservas) {
        await this.liberarReservaHandler.execute(new LiberarReservaCommand(res.id));
      }
    }

    // 2. Si era a crédito, liberar el cupo de crédito utilizado
    if (pedido.tipoPago.value === 'CREDITO') {
      await this.liberarCreditoHandler.execute(
        new LiberarCreditoCommand(pedido.clientId, pedido.montoTotal.amount),
      );
    }

    // 3. Desactivar en la cola si estaba en espera de stock
    if (estadoAnterior === PrismaEstadoPedido.EN_ESPERA_STOCK) {
      const qEntry = await this.queueRepository.findActiveByOrderId(pedido.id);
      if (qEntry) {
        await this.queueRepository.deactivate(qEntry.id);
      }
    }

    // Guardar cambios del pedido
    await this.pedidoRepository.update(pedido);
  }
}
