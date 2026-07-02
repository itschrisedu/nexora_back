import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { DomainException } from '../../../shared/domain/DomainException';
import { DispatchEstado } from '@prisma/client';
import { SeparacionConfirmadaPorBodegaEvent } from './events/PedidoEvents';

export class PermisoInsuficienteDespachoException extends DomainException {
  constructor(rol: string) {
    super(
      `El rol ${rol} no tiene permiso para confirmar la separación en bodega. Solo ROL_BODEGUERO o ROL_ADMIN.`,
      'PERMISO_INSUFICIENTE_DESPACHO',
    );
  }
}

export interface DispatchLineProps {
  id: string;
  productId: string;
  serieId: string;
  tallaId: string;
  cantidad: number;
  aceptada: boolean;
}

export class OrdenDespacho extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private readonly _orderId: string,
    private _estado: DispatchEstado,
    private readonly _lines: DispatchLineProps[],
    private _confirmadoPorId: string | null,
    private _confirmadoAt: Date | null,
    private readonly _createdAt: Date,
  ) {
    super();
  }

  static crear(id: string, orderId: string, lineas: Omit<DispatchLineProps, 'aceptada'>[]): OrdenDespacho {
    const lines: DispatchLineProps[] = lineas.map((l) => ({
      ...l,
      aceptada: true,
    }));

    return new OrdenDespacho(
      id,
      orderId,
      DispatchEstado.PENDIENTE_SEPARACION,
      lines,
      null,
      null,
      new Date(),
    );
  }

  // ── Getters ─────────────────────────────────

  get id(): string {
    return this._id;
  }

  get orderId(): string {
    return this._orderId;
  }

  get estado(): DispatchEstado {
    return this._estado;
  }

  get lines(): ReadonlyArray<DispatchLineProps> {
    return this._lines;
  }

  get confirmadoPorId(): string | null {
    return this._confirmadoPorId;
  }

  get confirmadoAt(): Date | null {
    return this._confirmadoAt;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  // ── Métodos de Negocio ──────────────────────

  confirmarSeparacion(userId: string, rol: string): void {
    if (rol !== 'ROL_BODEGUERO' && rol !== 'ROL_ADMIN') {
      throw new PermisoInsuficienteDespachoException(rol);
    }

    if (this._estado !== DispatchEstado.PENDIENTE_SEPARACION) {
      throw new Error(
        `No se puede confirmar la separación: el despacho está en estado ${this._estado}`,
      );
    }

    this._estado = DispatchEstado.SEPARADO;
    this._confirmadoPorId = userId;
    this._confirmadoAt = new Date();

    this.addDomainEvent(
      new SeparacionConfirmadaPorBodegaEvent(this._orderId, this._id, userId),
    );
  }

  marcarEnTransito(): void {
    if (this._estado !== DispatchEstado.SEPARADO) {
      throw new Error(
        `No se puede marcar en tránsito: el despacho debe estar SEPARADO, pero está en ${this._estado}`,
      );
    }
    this._estado = DispatchEstado.EN_TRANSITO;
  }

  // ── Reconstrucción ──────────────────────────

  static reconstruir(
    id: string,
    orderId: string,
    estado: DispatchEstado,
    lines: DispatchLineProps[],
    confirmadoPorId: string | null,
    confirmadoAt: Date | null,
    createdAt: Date,
  ): OrdenDespacho {
    return new OrdenDespacho(
      id,
      orderId,
      estado,
      lines,
      confirmadoPorId,
      confirmadoAt,
      createdAt,
    );
  }
}
