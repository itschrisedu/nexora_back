import { DomainEvent } from '../../../../shared/domain/DomainEvent';
import { EstadoPedido, CanalEntrada, TipoPago, TipoVenta } from '@prisma/client';

export interface LineaPedidoPrimitive {
  id: string;
  productId: string;
  serieId: string;
  tallaId: string;
  cantidad: number;
  precioUnitario: number;
  tipoVenta: TipoVenta;
}

export class PedidoCreadoEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly clientId: string,
    public readonly lineas: LineaPedidoPrimitive[],
    public readonly montoTotal: number,
    public readonly tipoPago: TipoPago,
  ) {
    super('PedidoCreado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      clientId: this.clientId,
      lineas: this.lineas,
      montoTotal: this.montoTotal,
      tipoPago: this.tipoPago,
    };
  }
}

export class PedidoEnEsperaStockEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly clientId: string,
    public readonly lineas: LineaPedidoPrimitive[],
    public readonly prioridadFifo: Date,
  ) {
    super('PedidoEnEsperaStock');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      clientId: this.clientId,
      lineas: this.lineas,
      prioridadFifo: this.prioridadFifo,
    };
  }
}

export class PedidoConfirmadoEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly clientId: string,
    public readonly montoTotal: number,
  ) {
    super('PedidoConfirmado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      clientId: this.clientId,
      montoTotal: this.montoTotal,
    };
  }
}

export class PedidoEnPreparacionEvent extends DomainEvent {
  constructor(public readonly pedidoId: string) {
    super('PedidoEnPreparacion');
  }

  toPrimitives(): Record<string, unknown> {
    return { pedidoId: this.pedidoId };
  }
}

export class PedidoEnTransitoEvent extends DomainEvent {
  constructor(public readonly pedidoId: string) {
    super('PedidoEnTransito');
  }

  toPrimitives(): Record<string, unknown> {
    return { pedidoId: this.pedidoId };
  }
}

export class PedidoCanceladoEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly clientId: string,
    public readonly lineas: LineaPedidoPrimitive[],
    public readonly montoTotal: number,
    public readonly tipoPago: TipoPago,
    public readonly motivo: string,
  ) {
    super('PedidoCancelado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      clientId: this.clientId,
      lineas: this.lineas,
      montoTotal: this.montoTotal,
      tipoPago: this.tipoPago,
      motivo: this.motivo,
    };
  }
}

export class PedidoEnColaActivadoEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly clientId: string,
  ) {
    super('PedidoEnColaActivado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      clientId: this.clientId,
    };
  }
}

export class PedidoEnColaRetenidoPorCreditoEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly clientId: string,
    public readonly razon: string,
    public readonly montoSolicitado: number,
    public readonly limiteDisponible: number,
  ) {
    super('PedidoEnColaRetenidoPorCredito');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      clientId: this.clientId,
      razon: this.razon,
      montoSolicitado: this.montoSolicitado,
      limiteDisponible: this.limiteDisponible,
    };
  }
}

// ══════════════════════════════════════════
// FASE 4B — Despacho, Modificación y Entrega
// ══════════════════════════════════════════

export interface LineaRechazadaPrimitive {
  productId: string;
  tallaId: string;
  cantidad: number;
}

export class PedidoModificadoEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly clientId: string,
    public readonly montoOriginal: number,
    public readonly montoNuevo: number,
    public readonly lineasRechazadas: LineaRechazadaPrimitive[],
    public readonly lineasAceptadas: LineaPedidoPrimitive[],
    public readonly tipoPago: TipoPago,
  ) {
    super('PedidoModificado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      clientId: this.clientId,
      montoOriginal: this.montoOriginal,
      montoNuevo: this.montoNuevo,
      lineasRechazadas: this.lineasRechazadas,
      lineasAceptadas: this.lineasAceptadas,
      tipoPago: this.tipoPago,
    };
  }
}

export class PedidoEntregadoEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly clientId: string,
    public readonly montoFinal: number,
    public readonly lineasEntregadas: LineaPedidoPrimitive[],
    public readonly tipoPago: TipoPago,
    public readonly canal: CanalEntrada,
  ) {
    super('PedidoEntregado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      clientId: this.clientId,
      montoFinal: this.montoFinal,
      lineasEntregadas: this.lineasEntregadas,
      tipoPago: this.tipoPago,
      canal: this.canal,
    };
  }
}

export class SeparacionConfirmadaPorBodegaEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly dispatchOrderId: string,
    public readonly userId: string,
  ) {
    super('SeparacionConfirmadaPorBodega');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      dispatchOrderId: this.dispatchOrderId,
      userId: this.userId,
    };
  }
}

export class StockLiberadoPorModificacionEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly lineas: LineaRechazadaPrimitive[],
  ) {
    super('StockLiberadoPorModificacion');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      lineas: this.lineas,
    };
  }
}

export class StockLiberadoPorCancelacionEvent extends DomainEvent {
  constructor(
    public readonly pedidoId: string,
    public readonly lineas: LineaRechazadaPrimitive[],
  ) {
    super('StockLiberadoPorCancelacion');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      pedidoId: this.pedidoId,
      lineas: this.lineas,
    };
  }
}

