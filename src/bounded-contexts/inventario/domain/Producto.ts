import { BadRequestException } from '@nestjs/common';
import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { Money } from '../../../shared/domain/Money';
import { Serie } from './value-objects/Serie';
import { StockPorTalla } from './value-objects/StockPorTalla';
import {
  ProductoCreado,
  PrecioCambiado,
  StockActualizado,
  StockBajoMinimo,
  StockReservado,
  StockLiberado,
  StockDadoDeBaja,
  StockDisponible,
} from './events';
import { StockInsuficienteException } from './exceptions/StockInsuficienteException';

/**
 * Registro inmutable del historial de cambios de precio para un calzado.
 * Mantiene la trazabilidad de auditoría entre costos y precios de venta al público.
 */
export interface PriceHistoryEntry {
  previousCostPrice: Money;
  previousSalePrice: Money;
  newCostPrice: Money;
  newSalePrice: Money;
  changedById: string;
  reason: string | null;
  createdAt: Date;
}

/**
 * Raíz de Agregado (Aggregate Root) que modela un calzado en el inventario.
 * Representa la combinación única de modelo, color, serie y proveedor.
 * Encapsula la gestión de stock distribuido por curvas de tallas,
 * reservas temporales, control de precios y valoración por método FIFO.
 */
export class Producto extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private _modelId: string,
    private _code: string,
    private _color: string,
    private _imageUrl: string | null,
    private _costPrice: Money,
    private _salePrice: Money,
    private _serie: Serie,
    private _stockPorTalla: Map<string, StockPorTalla>,
    private _priceHistory: PriceHistoryEntry[] = [],
    private _active: boolean = true,
    private _supplierId: string | null = null,
    // Campos del modelo padre y proveedor (para lectura, cargados desde el JOIN)
    private _modelName: string = '',
    private _modelBrand: string = '',
    private _modelBaseCode: string = '',
    private _modelMaterial: string | null = null,
    private _supplierName: string = '',
    private _supplierSigla: string = '',
  ) {
    super();
  }

  /**
   * Método de fábrica para instanciar un nuevo producto en el catálogo.
   * Valida que los precios iniciales sean estrictamente positivos y emite el evento ProductoCreado.
   *
   * @param id Identificador único del producto (UUID).
   * @param modelId Identificador del modelo base al que pertenece.
   * @param code Código SKU único del calzado.
   * @param color Variante de color del calzado.
   * @param imageUrl Enlace a la imagen del producto en almacenamiento.
   * @param costPrice Precio de costo inicial (adquisición al fabricante).
   * @param salePrice Precio de venta inicial sugerido al público.
   * @param serie Configuración de serie asociada (curva de tallas).
   * @param stockPorTallaList Lista inicial de existencias por cada talla.
   * @param supplierId Identificador del proveedor o taller artesanal asignado.
   * @returns Instancia inicializada del agregado Producto.
   */
  static crear(
    id: string,
    modelId: string,
    code: string,
    color: string,
    imageUrl: string | null,
    costPrice: Money,
    salePrice: Money,
    serie: Serie,
    stockPorTallaList: StockPorTalla[],
    supplierId: string | null = null,
  ): Producto {
    if (costPrice.amount <= 0 || salePrice.amount <= 0) {
      throw new Error('Los precios de costo y venta deben ser mayores que cero');
    }

    const stockMap = new Map<string, StockPorTalla>();
    stockPorTallaList.forEach((s) => stockMap.set(s.tallaId, s));

    const producto = new Producto(
      id,
      modelId,
      code,
      color,
      imageUrl,
      costPrice,
      salePrice,
      serie,
      stockMap,
      [],
      true,
      supplierId,
    );

    producto.addDomainEvent(new ProductoCreado(id, code, serie.value));

    return producto;
  }

  // ── Getters ─────────────────────────────────

  get id(): string {
    return this._id;
  }

  get modelId(): string {
    return this._modelId;
  }

  get code(): string {
    return this._code;
  }

  /** @deprecated Use code instead */
  get codigo(): string {
    return this._code;
  }

  get color(): string {
    return this._color;
  }

  get imageUrl(): string | null {
    return this._imageUrl;
  }

  /** @deprecated Use imageUrl instead */
  get fotoUrl(): string | null {
    return this._imageUrl;
  }

  get costPrice(): Money {
    return this._costPrice;
  }

  /** @deprecated Use costPrice instead */
  get precioCosto(): Money {
    return this._costPrice;
  }

  get salePrice(): Money {
    return this._salePrice;
  }

  /** @deprecated Use salePrice instead */
  get precioVenta(): Money {
    return this._salePrice;
  }

  get serie(): Serie {
    return this._serie;
  }

  get stockPorTalla(): ReadonlyMap<string, StockPorTalla> {
    return this._stockPorTalla;
  }

  get priceHistory(): ReadonlyArray<PriceHistoryEntry> {
    return this._priceHistory;
  }

  get active(): boolean {
    return this._active;
  }

  /** @deprecated Use active instead */
  get activo(): boolean {
    return this._active;
  }

  // Getters del modelo padre (solo lectura, poblados desde el JOIN)
  get nombre(): string {
    return this._modelName;
  }

  get marca(): string {
    return this._modelBrand;
  }

  get modelo(): string {
    return this._modelBaseCode;
  }

  get material(): string | null {
    return this._modelMaterial;
  }

  get supplierId(): string | null {
    return this._supplierId;
  }

  get supplierName(): string {
    return this._supplierName;
  }

  get supplierSigla(): string {
    return this._supplierSigla;
  }

  asignarProveedor(supplierId: string | null): void {
    this._supplierId = supplierId;
  }

  // ── Métodos de Negocio ──────────────────────

  /**
   * Modifica el precio de costo y venta del producto.
   * Almacena una entrada inmutable en el historial de precios y emite el evento PrecioCambiado.
   *
   * @param nuevoPrecioCosto Nuevo costo unitario de compra.
   * @param nuevoPrecioVenta Nuevo precio de venta al público en mostrador.
   * @param userId Identificador del usuario o proceso del sistema que efectúa el cambio.
   * @param motivo Justificación del cambio de precio (ej: transición FIFO, ajuste manual).
   * @throws Error si alguno de los precios no es estrictamente positivo.
   */
  cambiarPrecio(
    nuevoPrecioCosto: Money,
    nuevoPrecioVenta: Money,
    userId: string,
    motivo?: string,
  ): void {
    if (nuevoPrecioCosto.amount <= 0 || nuevoPrecioVenta.amount <= 0) {
      throw new Error('Los nuevos precios deben ser mayores que cero');
    }

    const anteriorCosto = this._costPrice;
    const anteriorVenta = this._salePrice;

    this._costPrice = nuevoPrecioCosto;
    this._salePrice = nuevoPrecioVenta;

    this._priceHistory.push({
      previousCostPrice: anteriorCosto,
      previousSalePrice: anteriorVenta,
      newCostPrice: nuevoPrecioCosto,
      newSalePrice: nuevoPrecioVenta,
      changedById: userId,
      reason: motivo || null,
      createdAt: new Date(),
    });

    this.addDomainEvent(
      new PrecioCambiado(
        this.id,
        anteriorCosto.amount,
        anteriorVenta.amount,
        nuevoPrecioCosto.amount,
        nuevoPrecioVenta.amount,
        userId,
      ),
    );
  }

  /**
   * Reserva pares en una talla específica para pedidos comerciales pendientes de despacho.
   * Verifica la disponibilidad física y emite StockReservado y StockBajoMinimo si aplica.
   *
   * @param tallaId Identificador de la talla a reservar.
   * @param cantidad Cantidad de pares a comprometer.
   * @param reservaId Identificador de la reserva o pedido.
   * @param expiresAt Fecha y hora de expiración de la reserva.
   * @throws StockInsuficienteException si la cantidad disponible es menor a la requerida.
   */
  reservarStock(
    tallaId: string,
    cantidad: number,
    reservaId: string,
    expiresAt: Date,
  ): void {
    const stock = this.obtenerStockOError(tallaId);

    if (stock.cantidadDisponible < cantidad) {
      throw new StockInsuficienteException(
        this.id,
        tallaId,
        stock.cantidadDisponible,
        cantidad,
        this._modelName || this.code,
        stock.numeroTalla,
      );
    }

    const nuevoStock = stock.aumentarReserva(cantidad);
    this._stockPorTalla.set(tallaId, nuevoStock);

    this.addDomainEvent(
      new StockReservado(this.id, tallaId, cantidad, reservaId, expiresAt),
    );

    if (nuevoStock.cantidadDisponible < nuevoStock.stockMinimo) {
      this.addDomainEvent(
        new StockBajoMinimo(
          this.id,
          tallaId,
          nuevoStock.cantidadDisponible,
          nuevoStock.stockMinimo,
        ),
      );
    }
  }

  /**
   * Libera una reserva previa devolviendo las unidades al inventario disponible.
   *
   * @param tallaId Identificador de la talla reservada.
   * @param cantidad Cantidad de pares a liberar.
   * @param reservaId Identificador de la reserva que se cancela o expira.
   */
  liberarReserva(tallaId: string, cantidad: number, reservaId: string): void {
    const stock = this.obtenerStockOError(tallaId);
    const nuevoStock = stock.disminuirReserva(cantidad);
    this._stockPorTalla.set(tallaId, nuevoStock);

    this.addDomainEvent(new StockLiberado(this.id, tallaId, cantidad));
  }

  /**
   * Descuenta stock físico de una talla tras una venta o despacho confirmado.
   *
   * @param tallaId Identificador de la talla vendida.
   * @param cantidad Cantidad de pares a descontar.
   * @throws Error si la cantidad a descontar supera la existencia física.
   */
  descontarStock(tallaId: string, cantidad: number): void {
    const stock = this.obtenerStockOError(tallaId);

    if (stock.cantidad < cantidad) {
      throw new Error('No es posible descontar más de la cantidad física real');
    }

    const anteriorCantidad = stock.cantidad;
    const nuevoStock = stock.disminuirFisico(cantidad);
    this._stockPorTalla.set(tallaId, nuevoStock);

    this.addDomainEvent(
      new StockActualizado(this.id, tallaId, anteriorCantidad, nuevoStock.cantidad),
    );
  }

  /**
   * Incrementa el stock físico de una talla por recepción de mercadería o compra.
   * Emite StockActualizado y StockDisponible si la talla se encontraba agotada.
   *
   * @param tallaId Identificador de la talla a incrementar.
   * @param cantidad Cantidad de pares recibidos.
   */
  aumentarStock(tallaId: string, cantidad: number): void {
    let stock = this._stockPorTalla.get(tallaId);
    if (!stock) {
      stock = StockPorTalla.create(tallaId, 0, 0, 0);
      (this._stockPorTalla as Map<string, StockPorTalla>).set(tallaId, stock);
    }
    const anteriorCantidad = stock.cantidad;
    const anteriorDisponible = stock.cantidadDisponible;

    const nuevoStock = stock.aumentarFisico(cantidad);
    (this._stockPorTalla as Map<string, StockPorTalla>).set(tallaId, nuevoStock);

    this.addDomainEvent(
      new StockActualizado(this.id, tallaId, anteriorCantidad, nuevoStock.cantidad),
    );

    if (anteriorDisponible <= 0 && nuevoStock.cantidadDisponible > 0) {
      this.addDomainEvent(
        new StockDisponible(this.id, tallaId, nuevoStock.cantidadDisponible),
      );
    }
  }

  /**
   * Registra la baja física de unidades de calzado por avería, defecto de fábrica o pérdida.
   *
   * @param tallaId Identificador de la talla a dar de baja.
   * @param cantidad Cantidad de pares a retirar.
   * @param motivo Justificación técnica u operativa de la baja.
   * @throws Error si la cantidad a retirar supera las existencias disponibles.
   */
  darDeBaja(tallaId: string, cantidad: number, motivo: string): void {
    const stock = this.obtenerStockOError(tallaId);

    if (stock.cantidadDisponible < cantidad) {
      throw new Error('No se puede dar de baja más stock del disponible');
    }

    const anteriorCantidad = stock.cantidad;
    const nuevoStock = stock.disminuirFisico(cantidad);
    this._stockPorTalla.set(tallaId, nuevoStock);

    this.addDomainEvent(
      new StockActualizado(this.id, tallaId, anteriorCantidad, nuevoStock.cantidad),
    );
    this.addDomainEvent(new StockDadoDeBaja(this.id, tallaId, cantidad, motivo));
  }

  // ── Reconstrucción ──────────────────────────

  /**
   * Reconstituye el agregado Producto desde la persistencia (Prisma) sin emitir eventos de dominio.
   * Utilizado exclusivamente por repositorios de infraestructura.
   */
  static reconstruir(
    id: string,
    modelId: string,
    code: string,
    color: string,
    imageUrl: string | null,
    costPrice: Money,
    salePrice: Money,
    serie: Serie,
    stockPorTallaList: StockPorTalla[],
    historial: PriceHistoryEntry[],
    active: boolean,
    modelName: string = '',
    modelBrand: string = '',
    modelBaseCode: string = '',
    modelMaterial: string | null = null,
    supplierId: string | null = null,
    supplierName: string = '',
    supplierSigla: string = '',
  ): Producto {
    const stockMap = new Map<string, StockPorTalla>();
    stockPorTallaList.forEach((s) => stockMap.set(s.tallaId, s));

    return new Producto(
      id,
      modelId,
      code,
      color,
      imageUrl,
      costPrice,
      salePrice,
      serie,
      stockMap,
      historial,
      active,
      supplierId,
      modelName,
      modelBrand,
      modelBaseCode,
      modelMaterial,
      supplierName,
      supplierSigla,
    );
  }

  // ── Utilidades ──────────────────────────────

  private obtenerStockOError(tallaId: string): StockPorTalla {
    const stock = this._stockPorTalla.get(tallaId);
    if (!stock) {
      const nombre = this._modelName ? `el modelo "${this._modelName}"` : `el producto "${this.code}"`;
      throw new BadRequestException(
        `La talla seleccionada no está configurada para ${nombre}`,
      );
    }
    return stock;
  }
}
