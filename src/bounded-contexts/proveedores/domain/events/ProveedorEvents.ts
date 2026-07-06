import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export interface MerchandiseEntryLinePrimitive {
  productId: string;
  tallaId: string;
  cantidadIngresada: number;
  precioCosto: number;
}

export class SupplierCreadoEvent extends DomainEvent {
  constructor(
    public readonly supplierId: string,
    public readonly ruc: string,
    public readonly razonSocial: string,
  ) {
    super('SupplierCreado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      supplierId: this.supplierId,
      ruc: this.ruc,
      razonSocial: this.razonSocial,
    };
  }
}

export class SupplierOrderCreadoEvent extends DomainEvent {
  constructor(
    public readonly orderId: string,
    public readonly numero: number,
    public readonly supplierId: string,
    public readonly total: number,
  ) {
    super('SupplierOrderCreado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      orderId: this.orderId,
      numero: this.numero,
      supplierId: this.supplierId,
      total: this.total,
    };
  }
}

export class SupplierOrderRecibidoEvent extends DomainEvent {
  constructor(
    public readonly orderId: string,
    public readonly supplierId: string,
  ) {
    super('SupplierOrderRecibido');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      orderId: this.orderId,
      supplierId: this.supplierId,
    };
  }
}

export class MerchandiseEntryRegistradaEvent extends DomainEvent {
  constructor(
    public readonly entradaId: string,
    public readonly numero: number,
    public readonly supplierId: string,
    public readonly total: number,
    public readonly lines: MerchandiseEntryLinePrimitive[],
    public readonly supplierOrderId?: string,
  ) {
    super('MerchandiseEntryRegistrada');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      entradaId: this.entradaId,
      numero: this.numero,
      supplierId: this.supplierId,
      total: this.total,
      lines: this.lines,
      supplierOrderId: this.supplierOrderId,
    };
  }
}
