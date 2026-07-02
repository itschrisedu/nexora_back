import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { Money } from '../../../shared/domain/Money';
import { EstadoPedido } from './value-objects/EstadoPedido';
import { CanalEntrada } from './value-objects/CanalEntrada';
import { TipoPago } from './value-objects/TipoPago';
import { LineaPedido } from './LineaPedido';
import { EstadoPedido as PrismaEstadoPedido } from '@prisma/client';
import {
  PedidoCreadoEvent,
  PedidoEnEsperaStockEvent,
  PedidoConfirmadoEvent,
  PedidoEnPreparacionEvent,
  PedidoEnTransitoEvent,
  PedidoCanceladoEvent,
  LineaPedidoPrimitive,
} from './events/PedidoEvents';

export class Pedido extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private readonly _clientId: string,
    private _estado: EstadoPedido,
    private readonly _canal: CanalEntrada,
    private readonly _tipoPago: TipoPago,
    private readonly _lineas: LineaPedido[],
    private _montoTotal: Money,
    private readonly _userId: string,
    private readonly _createdAt: Date,
  ) {
    super();
  }

  static crear(
    id: string,
    clientId: string,
    canal: CanalEntrada,
    tipoPago: TipoPago,
    lineas: LineaPedido[],
    estadoInicial: PrismaEstadoPedido,
    userId: string,
  ): Pedido {
    if (lineas.length === 0) {
      throw new Error('El pedido debe tener al menos una línea');
    }

    const total = lineas.reduce(
      (acc, line) => acc.add(line.subtotal),
      Money.create(0),
    );

    const pedido = new Pedido(
      id,
      clientId,
      EstadoPedido.create(estadoInicial),
      canal,
      tipoPago,
      lineas,
      total,
      userId,
      new Date(),
    );

    const lineasPrims = pedido.lineasPrimitives;

    if (estadoInicial === PrismaEstadoPedido.PENDIENTE) {
      pedido.addDomainEvent(
        new PedidoCreadoEvent(id, clientId, lineasPrims, total.amount, tipoPago.value),
      );
    } else if (estadoInicial === PrismaEstadoPedido.EN_ESPERA_STOCK) {
      pedido.addDomainEvent(
        new PedidoEnEsperaStockEvent(id, clientId, lineasPrims, pedido._createdAt),
      );
    }

    return pedido;
  }

  // ── Getters ─────────────────────────────────

  get id(): string {
    return this._id;
  }

  get clientId(): string {
    return this._clientId;
  }

  get estado(): EstadoPedido {
    return this._estado;
  }

  get canal(): CanalEntrada {
    return this._canal;
  }

  get tipoPago(): TipoPago {
    return this._tipoPago;
  }

  get lineas(): ReadonlyArray<LineaPedido> {
    return this._lineas;
  }

  get montoTotal(): Money {
    return this._montoTotal;
  }

  get userId(): string {
    return this._userId;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  // ── Métodos de Negocio ──────────────────────

  confirmar(): void {
    const anterior = this._estado.value;
    this._estado = this._estado.transicionarA(PrismaEstadoPedido.PENDIENTE);

    this.addDomainEvent(
      new PedidoConfirmadoEvent(this.id, this.clientId, this.montoTotal.amount),
    );
  }

  iniciarPreparacion(): void {
    this._estado = this._estado.transicionarA(PrismaEstadoPedido.EN_PREPARACION);
    this.addDomainEvent(new PedidoEnPreparacionEvent(this.id));
  }

  marcarEnTransito(): void {
    this._estado = this._estado.transicionarA(PrismaEstadoPedido.EN_TRANSITO);
    this.addDomainEvent(new PedidoEnTransitoEvent(this.id));
  }

  entregar(): void {
    this._estado = this._estado.transicionarA(PrismaEstadoPedido.ENTREGADO);
  }

  cancelar(motivo: string): void {
    const anterior = this._estado.value;
    this._estado = this._estado.transicionarA(PrismaEstadoPedido.CANCELADO);

    this.addDomainEvent(
      new PedidoCanceladoEvent(
        this.id,
        this.clientId,
        this.lineasPrimitives,
        this.montoTotal.amount,
        this.tipoPago.value,
        motivo,
      ),
    );
  }

  // ── Reconstrucción ──────────────────────────

  static reconstruir(
    id: string,
    clientId: string,
    estado: EstadoPedido,
    canal: CanalEntrada,
    tipoPago: TipoPago,
    lineas: LineaPedido[],
    montoTotal: Money,
    userId: string,
    createdAt: Date,
  ): Pedido {
    return new Pedido(
      id,
      clientId,
      estado,
      canal,
      tipoPago,
      lineas,
      montoTotal,
      userId,
      createdAt,
    );
  }

  // ── Helpers ─────────────────────────────────

  private get lineasPrimitives(): LineaPedidoPrimitive[] {
    return this._lineas.map((line) => ({
      id: line.id,
      productId: line.productId,
      serieId: line.serieId,
      tallaId: line.tallaId,
      cantidad: line.cantidad,
      precioUnitario: line.precioUnitario.amount,
      tipoVenta: line.tipoVenta.value,
    }));
  }
}
