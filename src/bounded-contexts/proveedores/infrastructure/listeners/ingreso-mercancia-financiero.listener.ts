import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CrearDeudaProveedorHandler } from '../../../financiero/application/commands/CrearDeudaProveedor.handler';
import { CrearDeudaProveedorCommand } from '../../../financiero/application/commands/CrearDeudaProveedor.command';
import { MerchandiseEntryLinePrimitive } from '../../domain/events/ProveedorEvents';

@Injectable()
export class IngresoMercanciaFinancieroListener {
  private readonly logger = new Logger(IngresoMercanciaFinancieroListener.name);

  constructor(private readonly crearDeudaHandler: CrearDeudaProveedorHandler) {}

  @OnEvent('MerchandiseEntryRegistrada')
  async handle(payload: {
    entradaId: string;
    numero: number;
    supplierId: string;
    total: number;
    lines: MerchandiseEntryLinePrimitive[];
  }) {
    this.logger.log(`💳 Reaccionando a entrada de mercancía N°${payload.numero} para registrar cuenta por pagar.`);
    try {
      // Por defecto la deuda con el proveedor vence en 30 días
      const fechaVencimiento = new Date();
      fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);

      await this.crearDeudaHandler.execute(
        new CrearDeudaProveedorCommand(
          payload.supplierId,
          payload.entradaId,
          payload.total,
          fechaVencimiento,
        ),
      );

      this.logger.log(`✅ Cuenta por pagar creada para proveedor ${payload.supplierId} — Monto: $${payload.total}`);
    } catch (error: any) {
      this.logger.error(`❌ Error registrando deuda por ingreso de mercancía ${payload.entradaId}: ${error.message}`);
    }
  }
}
