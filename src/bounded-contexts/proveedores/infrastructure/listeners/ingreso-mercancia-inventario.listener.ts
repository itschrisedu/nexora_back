import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AumentarStockHandler } from '../../../inventario/application/commands/AumentarStock.handler';
import { AumentarStockCommand } from '../../../inventario/application/commands/AumentarStock.command';
import { MerchandiseEntryLinePrimitive } from '../../domain/events/ProveedorEvents';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { ReservarStockHandler } from '../../../inventario/application/commands/ReservarStock.handler';
import { ReservarStockCommand } from '../../../inventario/application/commands/ReservarStock.command';
import { EstadoPedido } from '@prisma/client';

@Injectable()
export class IngresoMercanciaInventarioListener {
  private readonly logger = new Logger(IngresoMercanciaInventarioListener.name);

  constructor(
    private readonly aumentarStockHandler: AumentarStockHandler,
    private readonly reservarStockHandler: ReservarStockHandler,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('MerchandiseEntryRegistrada')
  async handle(payload: {
    entradaId: string;
    numero: number;
    supplierId: string;
    total: number;
    lines: MerchandiseEntryLinePrimitive[];
  }) {
    this.logger.log(`📦 Reaccionando a entrada de mercancía N°${payload.numero} para aumentar stock físico.`);
    for (const line of payload.lines) {
      if (!line.cantidadIngresada || line.cantidadIngresada <= 0) {
        continue;
      }

      try {
        await this.aumentarStockHandler.execute(
          new AumentarStockCommand(
            line.productId,
            line.tallaId,
            line.cantidadIngresada,
            'INGRESO_MERCANCIA',
            payload.entradaId,
            'SYSTEM', // Registrado por el sistema de forma asíncrona
          ),
        );
        this.logger.log(`✅ Stock aumentado para producto ${line.productId}, talla ${line.tallaId} — Cantidad: ${line.cantidadIngresada}`);
      } catch (lineError: any) {
        this.logger.error(`❌ Error en línea producto ${line.productId}, talla ${line.tallaId}: ${lineError.message}`);
      }
    }

    // ──────────────────────────────────────────────────────────
    // Reactivación automática de pedidos que estaban esperando stock
    // ──────────────────────────────────────────────────────────
    try {
      this.logger.log(`🔍 Evaluando pedidos en espera de stock tras ingreso de mercadería...`);
      const pedidosEnEspera = await this.prisma.order.findMany({
        where: {
          estado: {
            in: [EstadoPedido.EN_ESPERA_STOCK, EstadoPedido.PENDIENTE, EstadoPedido.ENTREGADO_PARCIAL],
          },
        },
        include: {
          lines: true,
        },
        orderBy: {
          createdAt: 'asc', // Prioridad FIFO
        },
      });

      for (const pedido of pedidosEnEspera) {
        let tieneStockParaTodo = true;
        let tieneStockParaAlMenosUno = false;
        const lineasAReservar: { productId: string; tallaId: string; cantidad: number }[] = [];

        for (const line of pedido.lines) {
          const pendiente = line.cantidad - (line.cantidadEntregada || 0);
          if (pendiente <= 0) continue;

          const stock = await this.prisma.stockByTalla.findUnique({
            where: {
              productId_tallaId: {
                productId: line.productId,
                tallaId: line.tallaId,
              },
            },
          });

          const disponible = stock ? stock.quantity - stock.reservedQuantity : 0;
          if (disponible >= pendiente) {
            lineasAReservar.push({
              productId: line.productId,
              tallaId: line.tallaId,
              cantidad: pendiente,
            });
            tieneStockParaAlMenosUno = true;
          } else {
            tieneStockParaTodo = false;
            if (disponible > 0) {
              lineasAReservar.push({
                productId: line.productId,
                tallaId: line.tallaId,
                cantidad: disponible,
              });
              tieneStockParaAlMenosUno = true;
            }
          }
        }

        // Si el pedido estaba EN_ESPERA_STOCK y ahora tiene stock completo o parcial, pasarlo a EN_PREPARACION
        if (pedido.estado === EstadoPedido.EN_ESPERA_STOCK && (tieneStockParaTodo || tieneStockParaAlMenosUno)) {
          // Reservar el stock disponible
          for (const res of lineasAReservar) {
            try {
              await this.reservarStockHandler.execute(
                new ReservarStockCommand(
                  res.productId,
                  res.tallaId,
                  res.cantidad,
                  'RESERVA_AUTOMATICA_MERCANCIA',
                  pedido.id,
                  1440,
                ),
              );
            } catch (err: any) {
              this.logger.warn(`No se pudo reservar stock para pedido ${pedido.id}: ${err.message}`);
            }
          }

          // Actualizar estado del pedido a EN_PREPARACION para que bodega/ventas pueda prepararlo y entregarlo
          await this.prisma.order.update({
            where: { id: pedido.id },
            data: { estado: EstadoPedido.EN_PREPARACION },
          });

          // Desactivar cola de espera si existía
          await this.prisma.orderQueue.updateMany({
            where: { orderId: pedido.id, activa: true },
            data: { activa: false, activadaAt: new Date() },
          });

          this.logger.log(`🚀 Pedido #${pedido.id.slice(0, 8)} reactivado y movido a EN_PREPARACION.`);
        } else if (pedido.estado === EstadoPedido.PENDIENTE && tieneStockParaTodo) {
          // Pedido pendiente pasa a EN_PREPARACION
          await this.prisma.order.update({
            where: { id: pedido.id },
            data: { estado: EstadoPedido.EN_PREPARACION },
          });
          this.logger.log(`📦 Pedido pendiente #${pedido.id.slice(0, 8)} pasó a EN_PREPARACION.`);
        }
      }
    } catch (reactivacionError: any) {
      this.logger.error(`❌ Error durante reactivación de pedidos: ${reactivacionError.message}`);
    }
  }
}
