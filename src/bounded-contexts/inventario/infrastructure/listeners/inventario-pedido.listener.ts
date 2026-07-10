import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { LiberarReservaHandler } from '../../application/commands/LiberarReserva.handler';
import { LiberarReservaCommand } from '../../application/commands/LiberarReserva.command';
import { DescontarStockHandler } from '../../application/commands/DescontarStock.handler';
import { DescontarStockCommand } from '../../application/commands/DescontarStock.command';

@Injectable()
export class InventarioPedidoListener {
  private readonly logger = new Logger(InventarioPedidoListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly liberarReservaHandler: LiberarReservaHandler,
    private readonly descontarStockHandler: DescontarStockHandler,
  ) {}

  @OnEvent('PedidoCancelado')
  async handlePedidoCancelado(payload: { pedidoId: string }) {
    this.logger.log(`🔄 Reaccionando a PedidoCancelado para liberar stock reservado de pedido: ${payload.pedidoId}`);
    try {
      // Buscar reservas activas para este pedido
      const reservas = await this.prisma.stockReservation.findMany({
        where: {
          referenceId: payload.pedidoId,
          canceled: false,
        },
      });

      for (const res of reservas) {
        await this.liberarReservaHandler.execute(new LiberarReservaCommand(res.id));
      }
      this.logger.log(`✅ Liberadas ${reservas.length} reservas para el pedido cancelado: ${payload.pedidoId}`);
    } catch (error: any) {
      this.logger.error(`❌ Error liberando reservas para pedido cancelado ${payload.pedidoId}: ${error.message}`);
    }
  }

  @OnEvent('PedidoModificado')
  async handlePedidoModificado(payload: {
    pedidoId: string;
    lineasRechazadas: Array<{ productId: string; tallaId: string; cantidad: number }>;
  }) {
    this.logger.log(`🔄 Reaccionando a PedidoModificado para liberar stock rechazado de pedido: ${payload.pedidoId}`);
    try {
      // Para cada línea rechazada, buscar si existe reserva activa y liberarla
      for (const rechazo of payload.lineasRechazadas) {
        const reservas = await this.prisma.stockReservation.findMany({
          where: {
            referenceId: payload.pedidoId,
            productId: rechazo.productId,
            tallaId: rechazo.tallaId,
            canceled: false,
          },
        });

        for (const res of reservas) {
          await this.liberarReservaHandler.execute(new LiberarReservaCommand(res.id));
        }
      }
      this.logger.log(`✅ Procesado rechazo parcial para pedido: ${payload.pedidoId}`);
    } catch (error: any) {
      this.logger.error(`❌ Error procesando rechazo parcial de pedido ${payload.pedidoId}: ${error.message}`);
    }
  }

  @OnEvent('PedidoEntregado')
  async handlePedidoEntregado(payload: {
    pedidoId: string;
    lineasEntregadas: Array<{ productId: string; tallaId: string; cantidad: number }>;
  }) {
    this.logger.log(`🔄 Reaccionando a PedidoEntregado para consolidar stock final de pedido: ${payload.pedidoId}`);
    try {
      // 1. Liberar todas las reservas pendientes asociadas a este pedido para devolver el stock al estado normal
      const reservas = await this.prisma.stockReservation.findMany({
        where: {
          referenceId: payload.pedidoId,
          canceled: false,
        },
      });

      for (const res of reservas) {
        await this.liberarReservaHandler.execute(new LiberarReservaCommand(res.id));
      }

      // 2. Descontar físicamente del stock real la cantidad de cada calzado entregado
      for (const linea of payload.lineasEntregadas) {
        await this.descontarStockHandler.execute(
          new DescontarStockCommand(
            linea.productId,
            linea.tallaId,
            linea.cantidad,
            'DESCUENTO_FISICO_VENTA_ENTREGADA',
            payload.pedidoId,
            'SYSTEM_EVENT_LISTENER',
          ),
        );
      }

      this.logger.log(`✅ Consolidación de stock completada para pedido entregado: ${payload.pedidoId}`);
    } catch (error: any) {
      this.logger.error(`❌ Error consolidando stock para pedido entregado ${payload.pedidoId}: ${error.message}`);
    }
  }
}
