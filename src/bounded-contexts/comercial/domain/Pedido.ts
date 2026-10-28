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
  PedidoModificadoEvent,
  PedidoEntregadoEvent,
  LineaPedidoPrimitive,
  LineaRechazadaPrimitive,
} from './events/PedidoEvents';

/**
 * Raíz de Agregado (Aggregate Root) que modela el ciclo de vida de un Pedido Comercial.
 * Controla el flujo de estados (PENDIENTE, EN_PREPARACION, EN_TRANSITO, ENTREGADO, CANCELADO, MODIFICADO),
 * el canal de origen (VENTA_DIRECTA, POS, CATALOGO_DIGITAL), tipo de pago (CONTADO, CREDITO, MIXTO)
 * y la integridad financiera de las líneas de calzado solicitadas.
 */
export class Pedido extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private readonly _clientId: string,
    private _estado: EstadoPedido,
    private readonly _canal: CanalEntrada,
    private readonly _tipoPago: TipoPago,
    private _lineas: LineaPedido[],
    private _montoTotal: Money,
    private readonly _userId: string,
    private readonly _createdAt: Date,
  ) {
    super();
  }

  /**
   * Método de fábrica para crear un nuevo pedido comercial.
   * Valida la existencia de al menos una línea con cantidad válida,
   * totaliza los subtotales y emite el evento correspondiente según el estado inicial.
   *
   * @param id Identificador único del pedido (UUID).
   * @param clientId Identificador del cliente que realiza el pedido.
   * @param canal Canal de venta utilizado.
   * @param tipoPago Condición de pago acordada.
   * @param lineas Lista de líneas de calzado solicitadas.
   * @param estadoInicial Estado inicial del pedido (PENDIENTE o EN_ESPERA_STOCK).
   * @param userId Identificador del usuario que registra el pedido.
   * @returns Instancia inicializada del agregado Pedido.
   * @throws Error si el pedido no contiene líneas.
   */
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

  // ── Métodos de Negocio (Fase 4A) ───────────

  /**
   * Confirma la disponibilidad de stock o aprobación comercial del pedido.
   * Transiciona el estado a PENDIENTE y emite PedidoConfirmadoEvent.
   */
  confirmar(): void {
    this._estado = this._estado.transicionarA(PrismaEstadoPedido.PENDIENTE);

    this.addDomainEvent(
      new PedidoConfirmadoEvent(this.id, this.clientId, this.montoTotal.amount),
    );
  }

  /**
   * Indica que el personal de bodega ha comenzado la separación física del calzado.
   * Transiciona a EN_PREPARACION y emite PedidoEnPreparacionEvent.
   */
  iniciarPreparacion(): void {
    this._estado = this._estado.transicionarA(PrismaEstadoPedido.EN_PREPARACION);
    this.addDomainEvent(new PedidoEnPreparacionEvent(this.id));
  }

  /**
   * Marca el pedido como despachado y en ruta de transporte hacia el cliente.
   * Transiciona a EN_TRANSITO y emite PedidoEnTransitoEvent.
   */
  marcarEnTransito(): void {
    this._estado = this._estado.transicionarA(PrismaEstadoPedido.EN_TRANSITO);
    this.addDomainEvent(new PedidoEnTransitoEvent(this.id));
  }

  /**
   * Cancela el pedido liberando reservas de inventario y cupo crediticio.
   * Transiciona a CANCELADO y emite PedidoCanceladoEvent con el motivo registrado.
   *
   * @param motivo Justificación operativa de la anulación.
   */
  cancelar(motivo: string): void {
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

  // ── Métodos de Negocio (Fase 4B) ───────────

  /**
   * Registra una modificación parcial del pedido cuando el cliente
   * rechaza algunas líneas durante la entrega en tránsito.
   * Si rechaza TODAS las líneas, equivale a cancelación total.
   */
  registrarModificacionEnTransito(lineasRechazadas: LineaRechazadaPrimitive[]): void {
    // Verificar si es cancelación total (todas las líneas rechazadas)
    const todasRechazadas = this._lineas.every((linea) =>
      lineasRechazadas.some(
        (r) => r.productId === linea.productId && r.tallaId === linea.tallaId && r.cantidad >= linea.cantidad,
      ),
    );

    if (todasRechazadas) {
      this.cancelar('Rechazo total de mercancía en entrega');
      return;
    }

    // Rechazo parcial: transicionar a MODIFICADO
    const montoOriginal = this._montoTotal.amount;

    // Filtrar líneas activas (las que NO fueron rechazadas completamente)
    const lineasAceptadas: LineaPedido[] = [];
    for (const linea of this._lineas) {
      const rechazo = lineasRechazadas.find(
        (r) => r.productId === linea.productId && r.tallaId === linea.tallaId,
      );
      if (!rechazo || rechazo.cantidad < linea.cantidad) {
        lineasAceptadas.push(linea);
      }
    }

    // Recalcular monto con las líneas aceptadas
    const nuevoTotal = lineasAceptadas.reduce(
      (acc, line) => acc.add(line.subtotal),
      Money.create(0),
    );

    this._estado = this._estado.transicionarA(PrismaEstadoPedido.MODIFICADO);
    this._montoTotal = nuevoTotal;
    this._lineas = lineasAceptadas;

    this.addDomainEvent(
      new PedidoModificadoEvent(
        this.id,
        this.clientId,
        montoOriginal,
        nuevoTotal.amount,
        lineasRechazadas,
        this.lineasPrimitives,
        this.tipoPago.value,
      ),
    );
  }

  /**
   * Confirma la entrega del pedido al cliente.
   * Solo posible desde EN_PREPARACION, EN_TRANSITO o MODIFICADO.
   */
  confirmarEntrega(): void {
    if (this._estado.value !== PrismaEstadoPedido.ENTREGADO) {
      this._estado = this._estado.transicionarA(PrismaEstadoPedido.ENTREGADO);
    }

    this.addDomainEvent(
      new PedidoEntregadoEvent(
        this.id,
        this.clientId,
        this.montoTotal.amount,
        this.lineasPrimitives,
        this.tipoPago.value,
        this.canal.value,
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

