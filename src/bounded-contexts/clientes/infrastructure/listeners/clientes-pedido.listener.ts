import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RegistrarCompraCompletadaHandler } from '../../application/commands/RegistrarCompraCompletada.handler';
import { RegistrarCompraCompletadaCommand } from '../../application/commands/RegistrarCompraCompletada.command';
import { LiberarCreditoHandler } from '../../application/commands/LiberarCredito.handler';
import { LiberarCreditoCommand } from '../../application/commands/LiberarCredito.command';

@Injectable()
export class ClientesPedidoListener {
  private readonly logger = new Logger(ClientesPedidoListener.name);

  constructor(
    private readonly registrarCompraCompletadaHandler: RegistrarCompraCompletadaHandler,
    private readonly liberarCreditoHandler: LiberarCreditoHandler,
  ) {}

  @OnEvent('PedidoCancelado')
  async handlePedidoCancelado(payload: {
    pedidoId: string;
    clientId: string;
    montoTotal: number;
    tipoPago: string;
  }) {
    if (payload.tipoPago === 'CREDITO') {
      this.logger.log(`🔄 Reaccionando a PedidoCancelado para liberar crédito del cliente: ${payload.clientId}`);
      try {
        await this.liberarCreditoHandler.execute(
          new LiberarCreditoCommand(payload.clientId, payload.montoTotal),
        );
        this.logger.log(`✅ Crédito de $${payload.montoTotal} liberado para cliente: ${payload.clientId}`);
      } catch (error: any) {
        this.logger.error(`❌ Error liberando crédito para cliente ${payload.clientId}: ${error.message}`);
      }
    }
  }

  @OnEvent('PedidoModificado')
  async handlePedidoModificado(payload: {
    pedidoId: string;
    clientId: string;
    montoOriginal: number;
    montoNuevo: number;
    tipoPago: string;
  }) {
    if (payload.tipoPago === 'CREDITO') {
      const diferencia = payload.montoOriginal - payload.montoNuevo;
      if (diferencia > 0) {
        this.logger.log(`🔄 Reaccionando a PedidoModificado para liberar crédito parcial del cliente: ${payload.clientId}`);
        try {
          await this.liberarCreditoHandler.execute(
            new LiberarCreditoCommand(payload.clientId, diferencia),
          );
          this.logger.log(`✅ Crédito parcial de $${diferencia} liberado para cliente: ${payload.clientId}`);
        } catch (error: any) {
          this.logger.error(`❌ Error liberando crédito parcial para cliente ${payload.clientId}: ${error.message}`);
        }
      }
    }
  }

  @OnEvent('PedidoEntregado')
  async handlePedidoEntregado(payload: {
    pedidoId: string;
    clientId: string;
    montoFinal: number;
    tipoPago: string;
  }) {
    this.logger.log(`🔄 Reaccionando a PedidoEntregado para registrar compra completada y recalcular scoring: ${payload.clientId}`);
    try {
      const esCredito = payload.tipoPago === 'CREDITO';
      await this.registrarCompraCompletadaHandler.execute(
        new RegistrarCompraCompletadaCommand(payload.clientId, payload.montoFinal, esCredito),
      );
      this.logger.log(`✅ Compra completada registrada exitosamente para cliente: ${payload.clientId}`);
    } catch (error: any) {
      this.logger.error(`❌ Error registrando compra completada para cliente ${payload.clientId}: ${error.message}`);
    }
  }
}
