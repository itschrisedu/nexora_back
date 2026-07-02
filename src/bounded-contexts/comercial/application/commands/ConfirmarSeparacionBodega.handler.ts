import { Injectable } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { OrdenDespacho, DispatchLineProps } from '../../domain/OrdenDespacho';

/**
 * ConfirmarSeparacionBodegaHandler
 * Confirma que el bodeguero separó los productos del pedido.
 * Crea la OrdenDespacho si no existe, la marca como SEPARADO y transiciona el Pedido a EN_TRANSITO.
 */
@Injectable()
export class ConfirmarSeparacionBodegaHandler {
  constructor(
    private readonly pedidoRepo: IPedidoRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: { pedidoId: string; userId: string; rol: string }): Promise<void> {
    const pedido = await this.pedidoRepo.findById(command.pedidoId);
    if (!pedido) {
      throw new Error(`Pedido ${command.pedidoId} no encontrado`);
    }

    // Verificar que el pedido esté EN_PREPARACION
    const estado = pedido.estado.value;
    if (estado !== 'EN_PREPARACION') {
      throw new Error(`El pedido debe estar EN_PREPARACION para confirmar separación, pero está en ${estado}`);
    }

    // Buscar o crear la OrdenDespacho
    let dispatchOrder = await this.prisma.dispatchOrder.findUnique({
      where: { orderId: command.pedidoId },
      include: { lines: true },
    });

    if (!dispatchOrder) {
      // Crear OrdenDespacho automáticamente
      const lineas = pedido.lineas.map((l) => ({
        productId: l.productId,
        serieId: l.serieId,
        tallaId: l.tallaId,
        cantidad: l.cantidad,
      }));

      dispatchOrder = await this.prisma.dispatchOrder.create({
        data: {
          orderId: command.pedidoId,
          estado: 'PENDIENTE_SEPARACION',
          lines: {
            create: lineas,
          },
        },
        include: { lines: true },
      });
    }

    // Reconstruir aggregate OrdenDespacho
    const dispatchLines: DispatchLineProps[] = dispatchOrder.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      serieId: l.serieId,
      tallaId: l.tallaId,
      cantidad: l.cantidad,
      aceptada: l.aceptada,
    }));

    const ordenDespacho = OrdenDespacho.reconstruir(
      dispatchOrder.id,
      dispatchOrder.orderId,
      dispatchOrder.estado,
      dispatchLines,
      dispatchOrder.confirmadoPorId,
      dispatchOrder.confirmadoAt,
      dispatchOrder.createdAt,
    );

    // Confirmar separación (valida rol)
    ordenDespacho.confirmarSeparacion(command.userId, command.rol);

    // Transicionar el pedido a EN_TRANSITO
    pedido.marcarEnTransito();

    // Persistir ambos cambios
    await this.prisma.dispatchOrder.update({
      where: { id: ordenDespacho.id },
      data: {
        estado: ordenDespacho.estado,
        confirmadoPorId: ordenDespacho.confirmadoPorId,
        confirmadoAt: ordenDespacho.confirmadoAt,
      },
    });

    await this.pedidoRepo.update(pedido);
  }
}
