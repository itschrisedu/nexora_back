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

    // Cambiar estado a CANCELADO en el aggregate root solo si no estaba ya cancelado
    if (estadoAnterior !== PrismaEstadoPedido.CANCELADO) {
      pedido.cancelar(command.motivo);
    }

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

    // 4. Reversión automática de préstamos inter-sucursal si este pedido recibió stock de otra sucursal
    const prestamosActivos = await this.prisma.stockMovement.findMany({
      where: {
        referenceId: pedido.id,
        quantity: { lt: 0 },
        reason: { contains: 'Préstamo inter-sucursal' },
      },
    });

    if (prestamosActivos.length > 0) {
      for (const mov of prestamosActivos) {
        const cantDevolver = Math.abs(mov.quantity);

        // Restituir inventario físico a la sucursal prestamista
        await this.prisma.stockByTalla.updateMany({
          where: {
            productId: mov.productId,
            tallaId: mov.tallaId,
          },
          data: {
            quantity: { increment: cantDevolver },
          },
        });

        // Registrar contra-movimiento de devolución por cancelación
        await this.prisma.stockMovement.create({
          data: {
            productId: mov.productId,
            tallaId: mov.tallaId,
            type: 'AJUSTE',
            quantity: cantDevolver,
            reason: `Devolución automática de préstamo por cancelación de Pedido #${pedido.id.slice(0, 8)} del cliente`,
            referenceId: pedido.id,
            userId: 'SISTEMA_CANCELACION',
          },
        });
      }

      // Actualizar notas del pedido para reflejar la sincronización
      const orderDb = await this.prisma.order.findUnique({ where: { id: pedido.id } });
      const notaSincronizacion = '[Préstamo Sincronizado]: Stock restituido y devuelto automáticamente a la sucursal prestamista.';
      const notasFinales = orderDb?.notas ? `${orderDb.notas} | ${notaSincronizacion}` : notaSincronizacion;
      await this.prisma.order.update({
        where: { id: pedido.id },
        data: { notas: notasFinales },
      });
    }

    // 5. Sincronizar, descontar o cancelar órdenes de compra a proveedores generadas en BORRADOR
    const refPedido = pedido.id.substring(0, 8).toUpperCase();
    const refPedidoLower = pedido.id.substring(0, 8).toLowerCase();
    const fullIdLower = pedido.id.toLowerCase();

    // Obtener todas las órdenes de compra en estado BORRADOR
    const ordenesCompraBorrador = await this.prisma.supplierOrder.findMany({
      where: { estado: 'BORRADOR' },
      include: { lines: true },
    });

    // Obtener IDs y referencias de todos los pedidos cancelados en el sistema (para limpiar también pruebas anteriores huérfanas)
    const pedidosCanceladosDb = await this.prisma.order.findMany({
      where: { estado: PrismaEstadoPedido.CANCELADO },
      select: { id: true },
    });
    const setIdsCancelados = new Set(pedidosCanceladosDb.map((p) => p.id.toLowerCase()));
    setIdsCancelados.add(fullIdLower);

    const setRefsCancelados = new Set(pedidosCanceladosDb.map((p) => p.id.substring(0, 8).toLowerCase()));
    setRefsCancelados.add(refPedidoLower);

    for (const oc of ordenesCompraBorrador) {
      // Si la orden fue ajustada manualmente a medida por el comerciante, no alterar sus cantidades
      if (oc.observaciones && oc.observaciones.includes('[AJUSTE_MANUAL]')) {
        continue;
      }

      let huboModificacionEnOrden = false;

      for (const line of oc.lines) {
        if (!line.observacionLinea) continue;
        const obs = line.observacionLinea;
        const obsLower = obs.toLowerCase();

        // Verificar si esta línea referencia a este pedido o a cualquier pedido cancelado
        let refCanceladaDetectada: string | null = null;
        for (const refItem of setRefsCancelados) {
          if (obsLower.includes(refItem)) {
            refCanceladaDetectada = refItem;
            break;
          }
        }
        if (!refCanceladaDetectada) {
          for (const idFull of setIdsCancelados) {
            if (obsLower.includes(idFull)) {
              refCanceladaDetectada = idFull.substring(0, 8);
              break;
            }
          }
        }

        if (!refCanceladaDetectada) continue;

        huboModificacionEnOrden = true;

        // Determinar cuántos pares de esta línea corresponden al pedido cancelado
        let paresARestar = 0;

        // Patrón 1: Formato acumulado "+Xp (Pedido #REF)"
        const regexAcumulado = new RegExp(`\\+(\\d+)p\\s*\\(Pedido\\s*#?${refCanceladaDetectada}\\)`, 'i');
        const matchAcumulado = obs.match(regexAcumulado);

        // Patrón 2: Formato original con desglose "Pedido #REF... (X pares) + 12 extra"
        const regexOriginal = new RegExp(`Pedido\\s*#?${refCanceladaDetectada}[^)]*\\((\\d+)\\s*pares?\\)\\s*\\+\\s*12\\s*extra`, 'i');
        const matchOriginal = obs.match(regexOriginal);

        // Patrón 3: Formato genérico "(X pares) + 12 extra" sin acumulación adicional
        const regexDirecto = /\((\d+)\s*pares?\)\s*\+\s*12\s*extra/i;
        const matchDirecto = obs.match(regexDirecto);

        if (matchAcumulado) {
          paresARestar = parseInt(matchAcumulado[1], 10);
        } else if (matchOriginal) {
          paresARestar = parseInt(matchOriginal[1], 10) + 12;
        } else if (matchDirecto && !obs.includes(' | +')) {
          paresARestar = line.cantidadPedida;
        } else if (!obs.includes(' | +')) {
          paresARestar = line.cantidadPedida;
        } else {
          paresARestar = line.cantidadPedida;
        }

        const nuevaCantidad = line.cantidadPedida - paresARestar;

        if (nuevaCantidad <= 0) {
          // La línea completa correspondía al pedido cancelado: eliminarla
          await this.prisma.supplierOrderLine.delete({
            where: { id: line.id },
          });
        } else {
          // Línea compartida con otros pedidos: restar solo la parte cancelada y limpiar observación
          const precioCosto = Number(line.precioCosto);
          let obsLimpia = obs;
          if (matchAcumulado) {
            obsLimpia = obsLimpia.replace(regexAcumulado, '').trim();
          } else if (matchOriginal) {
            obsLimpia = obsLimpia.replace(regexOriginal, '').trim();
          }
          obsLimpia = obsLimpia.replace(/\|\s*$/, '').trim();
          obsLimpia = obsLimpia.replace(/^\s*\|/, '').trim();
          obsLimpia = obsLimpia || `Ajustada por anulación de Pedido #${refCanceladaDetectada.toUpperCase()}`;

          await this.prisma.supplierOrderLine.update({
            where: { id: line.id },
            data: {
              cantidadPedida: nuevaCantidad,
              subtotal: nuevaCantidad * precioCosto,
              observacionLinea: `${obsLimpia} | [-${paresARestar}p por anulación Pedido #${refCanceladaDetectada.toUpperCase()}]`,
            },
          });
        }
      }

      if (huboModificacionEnOrden) {
        // Recalcular líneas restantes y total de la orden de compra
        const lineasRestantes = await this.prisma.supplierOrderLine.findMany({
          where: { supplierOrderId: oc.id },
        });

        if (lineasRestantes.length === 0) {
          await this.prisma.supplierOrder.update({
            where: { id: oc.id },
            data: {
              estado: 'CANCELADA',
              total: 0,
              observaciones: `${oc.observaciones || ''} | [Cancelada automáticamente al anularse los pedidos de clientes asociados]`,
            },
          });
        } else {
          const nuevoTotal = lineasRestantes.reduce((acc: number, l: any) => acc + Number(l.subtotal || 0), 0);
          await this.prisma.supplierOrder.update({
            where: { id: oc.id },
            data: {
              total: nuevoTotal,
              observaciones: `${oc.observaciones || ''} | [Ajustada automáticamente al anularse pedidos de clientes asociados]`,
            },
          });
        }
      }
    }

    // Guardar cambios del pedido si no estaba ya cancelado
    if (estadoAnterior !== PrismaEstadoPedido.CANCELADO) {
      await this.pedidoRepository.update(pedido);
    }
  }
}
