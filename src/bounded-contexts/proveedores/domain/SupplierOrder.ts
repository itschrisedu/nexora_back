import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { DomainException } from '../../../shared/domain/DomainException';
import { SupplierOrderStatus } from '@prisma/client';
import { SupplierOrderCreadoEvent, SupplierOrderRecibidoEvent } from './events/ProveedorEvents';

export interface SupplierOrderLineProps {
  id: string;
  productId: string;
  cantidadPedida: number;
  precioCosto: number;
  subtotal: number;
}

export class SupplierOrderSinLineasException extends DomainException {
  constructor() {
    super('Una orden de compra debe tener al menos una línea.', 'ORDEN_COMPRA_SIN_LINEAS');
  }
}

export class CantidadPedidaInvalidaException extends DomainException {
  constructor() {
    super('La cantidad pedida debe ser mayor a 0.', 'CANTIDAD_INVALIDA');
  }
}

export class PrecioCostoInvalidoException extends DomainException {
  constructor() {
    super('El precio de costo debe ser mayor a 0.', 'PRECIO_COSTO_INVALIDO');
  }
}

export class EstadoOrdenInvalidoException extends DomainException {
  constructor(estado: string) {
    super(`No se puede realizar la operación sobre una orden en estado ${estado}.`, 'ESTADO_ORDEN_INVALIDO');
  }
}

export class SupplierOrder extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private readonly _numero: number,
    private readonly _supplierId: string,
    private _total: number,
    private _estado: SupplierOrderStatus,
    private readonly _lines: SupplierOrderLineProps[],
    private readonly _createdAt: Date,
  ) {
    super();
  }

  static crear(
    id: string,
    numero: number,
    supplierId: string,
    lines: Array<{ id: string; productId: string; cantidadPedida: number; precioCosto: number }>,
  ): SupplierOrder {
    if (lines.length === 0) {
      throw new SupplierOrderSinLineasException();
    }

    const orderLines: SupplierOrderLineProps[] = lines.map((l) => {
      if (l.cantidadPedida <= 0) {
        throw new CantidadPedidaInvalidaException();
      }
      if (l.precioCosto <= 0) {
        throw new PrecioCostoInvalidoException();
      }
      return {
        id: l.id,
        productId: l.productId,
        cantidadPedida: l.cantidadPedida,
        precioCosto: l.precioCosto,
        subtotal: l.cantidadPedida * l.precioCosto,
      };
    });

    const total = orderLines.reduce((acc, curr) => acc + curr.subtotal, 0);

    const order = new SupplierOrder(
      id,
      numero,
      supplierId,
      total,
      SupplierOrderStatus.PENDIENTE,
      orderLines,
      new Date(),
    );

    order.addDomainEvent(new SupplierOrderCreadoEvent(id, numero, supplierId, total));
    return order;
  }

  // Getters
  get id(): string { return this._id; }
  get numero(): number { return this._numero; }
  get supplierId(): string { return this._supplierId; }
  get total(): number { return this._total; }
  get estado(): SupplierOrderStatus { return this._estado; }
  get lines(): ReadonlyArray<SupplierOrderLineProps> { return this._lines; }
  get createdAt(): Date { return this._createdAt; }

  // Métodos de Negocio
  marcarComoRecibida(): void {
    if (this._estado !== SupplierOrderStatus.PENDIENTE) {
      throw new EstadoOrdenInvalidoException(this._estado);
    }
    this._estado = SupplierOrderStatus.RECIBIDA;
    this.addDomainEvent(new SupplierOrderRecibidoEvent(this._id, this._supplierId));
  }

  cancelar(): void {
    if (this._estado !== SupplierOrderStatus.PENDIENTE) {
      throw new EstadoOrdenInvalidoException(this._estado);
    }
    this._estado = SupplierOrderStatus.CANCELADA;
  }

  static reconstruir(
    id: string,
    numero: number,
    supplierId: string,
    total: number,
    estado: SupplierOrderStatus,
    lines: SupplierOrderLineProps[],
    createdAt: Date,
  ): SupplierOrder {
    return new SupplierOrder(id, numero, supplierId, total, estado, lines, createdAt);
  }
}
