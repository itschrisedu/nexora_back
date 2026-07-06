import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RegistrarCompraCompletadaHandler } from '../../../clientes/application/commands/RegistrarCompraCompletada.handler';
import { RegistrarCompraCompletadaCommand } from '../../../clientes/application/commands/RegistrarCompraCompletada.command';
import { RegistrarAtrasoHandler } from '../../../clientes/application/commands/RegistrarAtraso.handler';
import { RegistrarAtrasoCommand } from '../../../clientes/application/commands/RegistrarAtraso.command';

/**
 * DeudaSaldadaListener — BC Clientes reacciona a que un cobro fue saldado:
 *   - CONTADO: registra compra completada inmediatamente.
 *   - CREDITO saldado a tiempo: registra compra completada (puede subir nivel).
 *   - CREDITO vencido sin pago: registra atraso (puede bajar nivel).
 */
@Injectable()
export class DeudaSaldadaClientesListener {
  private readonly logger = new Logger(DeudaSaldadaClientesListener.name);

  constructor(
    private readonly registrarCompraCompletadaHandler: RegistrarCompraCompletadaHandler,
    private readonly registrarAtrasoHandler: RegistrarAtrasoHandler,
  ) {}

  @OnEvent('DeudaSaldada')
  async handleDeudaSaldada(payload: {
    cobroId: string;
    clientId: string;
    montoTotal: number;
    tipo: string;
  }) {
    this.logger.log(`🏅 Reaccionando a DeudaSaldada para cliente: ${payload.clientId}`);
    try {
      const esCredito = payload.tipo === 'CREDITO';
      await this.registrarCompraCompletadaHandler.execute(
        new RegistrarCompraCompletadaCommand(payload.clientId, payload.montoTotal, esCredito),
      );
      this.logger.log(`✅ Compra completada registrada para cliente ${payload.clientId} — Monto: $${payload.montoTotal}`);
    } catch (error: any) {
      this.logger.error(`❌ Error registrando compra completada para cliente ${payload.clientId}: ${error.message}`);
    }
  }

  @OnEvent('CobroVencidoSinPago')
  async handleCobroVencido(payload: {
    cobroId: string;
    clientId: string;
    saldoPendiente: number;
    diasVencido: number;
  }) {
    this.logger.log(`⚠️ Reaccionando a CobroVencidoSinPago para cliente: ${payload.clientId}`);
    try {
      await this.registrarAtrasoHandler.execute(
        new RegistrarAtrasoCommand(payload.clientId),
      );
      this.logger.log(`✅ Atraso registrado para cliente ${payload.clientId} — ${payload.diasVencido} días vencido`);
    } catch (error: any) {
      this.logger.error(`❌ Error registrando atraso para cliente ${payload.clientId}: ${error.message}`);
    }
  }
}
