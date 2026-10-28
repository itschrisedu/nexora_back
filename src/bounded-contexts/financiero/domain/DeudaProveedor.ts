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

/**
 * Raíz de Agregado (Aggregate Root) que gestiona las Cuentas por Pagar a Proveedores.
 * Administra las obligaciones financieras derivadas de ingresos de mercadería a crédito,
 * controla pagos y amortizaciones parciales y verifica que ningún pago exceda la deuda.
 */
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

  /**
   * Crea una nueva cuenta por pagar asociada a una recepción de mercadería a crédito.
   *
   * @param id Identificador único de la deuda (UUID).
   * @param supplierId Identificador del proveedor acreedor.
   * @param entradaId Identificador del comprobante o recepción de mercadería que originó la deuda.
   * @param montoTotal Importe total facturado por el proveedor.
   * @param fechaVencimiento Fecha límite acordada para la cancelación.
   * @returns Instancia de DeudaProveedor en estado PENDIENTE.
   */
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
   * Registra un pago o abono parcial/total a la deuda con el proveedor.
   * Aplica invariantes de dominio:
   * 1. No permite registrar pagos si la deuda ya fue SALDADA.
   * 2. El importe no puede superar el saldo pendiente actual.
   *
   * @param pagoId Identificador único del pago (UUID).
   * @param monto Monto cancelado al proveedor.
   * @param metodo Forma de egreso monetario (EFECTIVO, TRANSFERENCIA, CHEQUE).
   * @param userId Identificador del usuario que efectúa el desembolso.
   * @param notas Referencia del comprobante o número de cheque.
   * @throws DeudaYaSaldadaException si la deuda ya se encontraba liquidada.
   * @throws PagoSuperaDeudaException si el pago supera el saldo remanente.
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
