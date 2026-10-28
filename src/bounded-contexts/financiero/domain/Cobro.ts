import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { Money } from '../../../shared/domain/Money';
import { DomainException } from '../../../shared/domain/DomainException';
import { CobroEstado, TipoCobro } from '@prisma/client';
import {
  CobroCreadoEvent,
  AbonoRegistradoEvent,
  DeudaSaldadaEvent,
} from './events/FinancieroEvents';

export class AbonoPorEncimaSaldoException extends DomainException {
  constructor(monto: number, saldoPendiente: number) {
    super(
      `El abono de $${monto.toFixed(2)} supera el saldo pendiente de $${saldoPendiente.toFixed(2)}`,
      'ABONO_POR_ENCIMA_SALDO',
    );
  }
}

export class CobroYaSaldadoException extends DomainException {
  constructor(cobroId: string) {
    super(
      `El cobro ${cobroId} ya está saldado y no acepta más abonos`,
      'COBRO_YA_SALDADO',
    );
  }
}

export interface AbonoProps {
  id: string;
  cobroId: string;
  monto: Money;
  metodo: string;
  notas?: string;
  userId: string;
  createdAt: Date;
}

/**
 * Raíz de Agregado (Aggregate Root) que gestiona el Cobro y la Cartera de Clientes.
 * Modela cobros al contado y a crédito, controla los abonos parciales,
 * asegura que ningún abono supere el saldo pendiente y emite eventos de liquidación de deuda.
 */
export class Cobro extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private readonly _saleNoteId: string,
    private readonly _clientId: string,
    private _tipo: TipoCobro,
    private readonly _montoTotal: Money,
    private _saldoPendiente: Money,
    private _estado: CobroEstado,
    private readonly _abonos: AbonoProps[],
    private readonly _fechaVencimiento: Date | null,
    private readonly _createdAt: Date,
  ) {
    super();
  }

  // ── Factory Methods ────────────────────────

  /**
   * Crea un cobro bajo modalidad CONTADO.
   * Nace en estado SALDADO con saldo pendiente $0 y emite CobroCreadoEvent y DeudaSaldadaEvent.
   *
   * @param id Identificador único del cobro (UUID).
   * @param saleNoteId Identificador de la nota de venta o transacción asociada.
   * @param clientId Identificador del cliente.
   * @param montoTotal Monto total cancelado.
   * @returns Instancia de Cobro saldada.
   */
  static crearContado(
    id: string,
    saleNoteId: string,
    clientId: string,
    montoTotal: Money,
  ): Cobro {
    const cobro = new Cobro(
      id,
      saleNoteId,
      clientId,
      TipoCobro.CONTADO,
      montoTotal,
      Money.create(0),   // saldo pendiente = 0
      CobroEstado.SALDADO, // contado = pagado en el acto
      [],
      null,
      new Date(),
    );

    cobro.addDomainEvent(
      new CobroCreadoEvent(id, saleNoteId, clientId, montoTotal.amount, TipoCobro.CONTADO),
    );
    cobro.addDomainEvent(
      new DeudaSaldadaEvent(id, clientId, montoTotal.amount, TipoCobro.CONTADO),
    );

    return cobro;
  }

  /**
   * Crea un cobro bajo modalidad CRÉDITO.
   * Nace en estado PENDIENTE con saldo pendiente igual al total adeudado.
   *
   * @param id Identificador único del cobro (UUID).
   * @param saleNoteId Identificador de la nota de venta vinculada.
   * @param clientId Identificador del cliente deudor.
   * @param montoTotal Monto total del crédito otorgado.
   * @param fechaVencimiento Plazo límite acordado para cancelar la deuda.
   * @returns Instancia de Cobro en estado PENDIENTE.
   */
  static crearCredito(
    id: string,
    saleNoteId: string,
    clientId: string,
    montoTotal: Money,
    fechaVencimiento: Date,
  ): Cobro {
    const cobro = new Cobro(
      id,
      saleNoteId,
      clientId,
      TipoCobro.CREDITO,
      montoTotal,
      montoTotal,          // saldo pendiente = monto total
      CobroEstado.PENDIENTE,
      [],
      fechaVencimiento,
      new Date(),
    );

    cobro.addDomainEvent(
      new CobroCreadoEvent(id, saleNoteId, clientId, montoTotal.amount, TipoCobro.CREDITO),
    );

    return cobro;
  }

  // ── Getters ────────────────────────────────

  get id(): string { return this._id; }
  get saleNoteId(): string { return this._saleNoteId; }
  get clientId(): string { return this._clientId; }
  get tipo(): TipoCobro { return this._tipo; }
  get montoTotal(): Money { return this._montoTotal; }
  get saldoPendiente(): Money { return this._saldoPendiente; }
  get estado(): CobroEstado { return this._estado; }
  get abonos(): ReadonlyArray<AbonoProps> { return this._abonos; }
  get fechaVencimiento(): Date | null { return this._fechaVencimiento; }
  get createdAt(): Date { return this._createdAt; }

  // ── Métodos de Negocio ─────────────────────

  /**
   * Registra un abono parcial o total contra el saldo del cobro.
   * Aplica invariantes de dominio:
   * 1. El monto del abono no puede superar el saldo pendiente actual.
   * 2. Un cobro ya en estado SALDADO no acepta abonos posteriores.
   * Si el saldo llega a $0, transiciona a SALDADO y emite DeudaSaldadaEvent.
   *
   * @param abonoId Identificador único del abono (UUID).
   * @param monto Valor monetario del abono recibido.
   * @param metodo Forma de pago (EFECTIVO, TRANSFERENCIA, DEPOSITO).
   * @param userId Identificador del cobrador o usuario en sesión.
   * @param notas Referencia o comentario del comprobante bancario.
   * @throws CobroYaSaldadoException si el cobro ya se encuentra liquidado.
   * @throws AbonoPorEncimaSaldoException si el abono supera el saldo remanente.
   */
  registrarAbono(
    abonoId: string,
    monto: Money,
    metodo: string,
    userId: string,
    notas?: string,
  ): void {
    // Invariante 2: cobro ya saldado
    if (this._estado === CobroEstado.SALDADO) {
      throw new CobroYaSaldadoException(this._id);
    }

    // Invariante 1: abono no puede superar el saldo
    if (monto.amount > this._saldoPendiente.amount) {
      throw new AbonoPorEncimaSaldoException(monto.amount, this._saldoPendiente.amount);
    }

    // Reducir saldo pendiente
    this._saldoPendiente = this._saldoPendiente.subtract(monto);

    // Actualizar estado
    if (this._saldoPendiente.amount === 0) {
      this._estado = CobroEstado.SALDADO;
    } else {
      this._estado = CobroEstado.PARCIALMENTE_PAGADO;
    }

    // Registrar el abono
    this._abonos.push({
      id: abonoId,
      cobroId: this._id,
      monto,
      metodo,
      notas,
      userId,
      createdAt: new Date(),
    });

    // Emitir eventos
    this.addDomainEvent(
      new AbonoRegistradoEvent(
        this._id,
        this._clientId,
        monto.amount,
        this._saldoPendiente.amount,
        metodo,
      ),
    );

    if (this._estado === CobroEstado.SALDADO) {
      this.addDomainEvent(
        new DeudaSaldadaEvent(this._id, this._clientId, this._montoTotal.amount, this._tipo),
      );
    }
  }

  /**
   * Reclasifica el tipo de cobro a CONTADO (ej: pronto pago dentro de las 24h).
   */
  reclasificarAContado(): void {
    this._tipo = TipoCobro.CONTADO;
  }

  // ── Reconstrucción ─────────────────────────

  static reconstruir(
    id: string,
    saleNoteId: string,
    clientId: string,
    tipo: TipoCobro,
    montoTotal: Money,
    saldoPendiente: Money,
    estado: CobroEstado,
    abonos: AbonoProps[],
    fechaVencimiento: Date | null,
    createdAt: Date,
  ): Cobro {
    return new Cobro(
      id,
      saleNoteId,
      clientId,
      tipo,
      montoTotal,
      saldoPendiente,
      estado,
      abonos,
      fechaVencimiento,
      createdAt,
    );
  }
}
