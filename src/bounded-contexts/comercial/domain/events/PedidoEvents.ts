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
