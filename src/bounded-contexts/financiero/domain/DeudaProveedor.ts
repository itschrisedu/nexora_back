import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { Money } from '../../../shared/domain/Money';
import { DomainException } from '../../../shared/domain/DomainException';
import { DeudaEstado } from '@prisma/client';
import {
  DeudaProveedorCreadaEvent,
  PagoProveedorRegistradoEvent,
  DeudaProveedorSaldadaEvent,
} from './events/FinancieroEvents';

export class PagoSuperaDeudaException extends DomainException {
  constructor(monto: number, saldoPendiente: number) {
    super(
      `El pago de $${monto.toFixed(2)} supera la deuda pendiente de $${saldoPendiente.toFixed(2)}`,
      'PAGO_SUPERA_DEUDA',
    );
  }
}

export class DeudaYaSaldadaException extends DomainException {
  constructor(deudaId: string) {
    super(
      `La deuda ${deudaId} ya está saldada y no acepta más pagos`,
      'DEUDA_YA_SALDADA',
    );
  }
}

export interface PagoProveedorProps {
  id: string;
  deudaId: string;
  monto: Money;
  metodo: string;
  notas?: string;
  userId: string;
  createdAt: Date;
}

export class DeudaProveedor extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private readonly _supplierId: string,
    private readonly _entradaId: string,
    private readonly _montoTotal: Money,
    private _saldoPendiente: Money,
    private readonly _fechaVencimiento: Date,
    private _estado: DeudaEstado,
    private readonly _pagos: PagoProveedorProps[],
    private readonly _createdAt: Date,
  ) {
    super();
  }

  // ── Factory Methods ────────────────────────

  static crear(
    id: string,
    supplierId: string,
    entradaId: string,
    montoTotal: Money,
    fechaVencimiento: Date,
  ): DeudaProveedor {
    const deuda = new DeudaProveedor(
      id,
      supplierId,
      entradaId,
      montoTotal,
      montoTotal,           // saldo pendiente = monto total
      fechaVencimiento,
      DeudaEstado.PENDIENTE,
      [],
      new Date(),
    );

    deuda.addDomainEvent(
      new DeudaProveedorCreadaEvent(id, supplierId, entradaId, montoTotal.amount, fechaVencimiento),
    );

    return deuda;
  }

  // ── Getters ────────────────────────────────

  get id(): string { return this._id; }
  get supplierId(): string { return this._supplierId; }
  get entradaId(): string { return this._entradaId; }
  get montoTotal(): Money { return this._montoTotal; }
  get saldoPendiente(): Money { return this._saldoPendiente; }
  get fechaVencimiento(): Date { return this._fechaVencimiento; }
  get estado(): DeudaEstado { return this._estado; }
  get pagos(): ReadonlyArray<PagoProveedorProps> { return this._pagos; }
  get createdAt(): Date { return this._createdAt; }

  // ── Métodos de Negocio ─────────────────────

  /**
   * Registra un pago parcial o total a la deuda de un proveedor.
   * Invariante: el pago no puede superar el saldo pendiente.
   */
  registrarPago(
    pagoId: string,
    monto: Money,
    metodo: string,
    userId: string,
    notas?: string,
  ): void {
    if (this._estado === DeudaEstado.SALDADO) {
      throw new DeudaYaSaldadaException(this._id);
    }

    if (monto.amount > this._saldoPendiente.amount) {
      throw new PagoSuperaDeudaException(monto.amount, this._saldoPendiente.amount);
    }

    this._saldoPendiente = this._saldoPendiente.subtract(monto);

    if (this._saldoPendiente.amount === 0) {
      this._estado = DeudaEstado.SALDADO;
    } else {
      this._estado = DeudaEstado.PARCIALMENTE_PAGADO;
    }

    this._pagos.push({
      id: pagoId,
      deudaId: this._id,
      monto,
      metodo,
      notas,
      userId,
      createdAt: new Date(),
    });

    this.addDomainEvent(
      new PagoProveedorRegistradoEvent(
        this._id,
        this._supplierId,
        monto.amount,
        this._saldoPendiente.amount,
      ),
    );

    if (this._estado === DeudaEstado.SALDADO) {
      this.addDomainEvent(
        new DeudaProveedorSaldadaEvent(this._id, this._supplierId, this._montoTotal.amount),
      );
    }
  }

  // ── Reconstrucción ─────────────────────────

  static reconstruir(
    id: string,
    supplierId: string,
    entradaId: string,
    montoTotal: Money,
    saldoPendiente: Money,
    fechaVencimiento: Date,
    estado: DeudaEstado,
    pagos: PagoProveedorProps[],
    createdAt: Date,
  ): DeudaProveedor {
    return new DeudaProveedor(
      id,
      supplierId,
      entradaId,
      montoTotal,
      saldoPendiente,
      fechaVencimiento,
      estado,
      pagos,
      createdAt,
    );
  }
}
