import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AumentarStockHandler } from '../../../inventario/application/commands/AumentarStock.handler';
import { AumentarStockCommand } from '../../../inventario/application/commands/AumentarStock.command';
import { MerchandiseEntryLinePrimitive } from '../../domain/events/ProveedorEvents';

@Injectable()
export class IngresoMercanciaInventarioListener {
  private readonly logger = new Logger(IngresoMercanciaInventarioListener.name);

  constructor(private readonly aumentarStockHandler: AumentarStockHandler) {}

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
  }
}
