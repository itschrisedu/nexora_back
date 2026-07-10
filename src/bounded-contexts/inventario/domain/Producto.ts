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

export interface PriceHistoryEntry {
  previousCostPrice: Money;
  previousSalePrice: Money;
  newCostPrice: Money;
  newSalePrice: Money;
  changedById: string;
  reason: string | null;
  createdAt: Date;
}

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
    // Campos del modelo padre (para lectura, cargados desde el JOIN)
    private _modelName: string = '',
    private _modelBrand: string = '',
    private _modelBaseCode: string = '',
    private _modelMaterial: string | null = null,
  ) {
    super();
  }

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

  // ── Métodos de Negocio ──────────────────────

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

  liberarReserva(tallaId: string, cantidad: number, reservaId: string): void {
    const stock = this.obtenerStockOError(tallaId);
    const nuevoStock = stock.disminuirReserva(cantidad);
    this._stockPorTalla.set(tallaId, nuevoStock);

    this.addDomainEvent(new StockLiberado(this.id, tallaId, cantidad));
  }

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

  aumentarStock(tallaId: string, cantidad: number): void {
    const stock = this.obtenerStockOError(tallaId);
    const anteriorCantidad = stock.cantidad;
    const anteriorDisponible = stock.cantidadDisponible;

    const nuevoStock = stock.aumentarFisico(cantidad);
    this._stockPorTalla.set(tallaId, nuevoStock);

    this.addDomainEvent(
      new StockActualizado(this.id, tallaId, anteriorCantidad, nuevoStock.cantidad),
    );

    if (anteriorDisponible <= 0 && nuevoStock.cantidadDisponible > 0) {
      this.addDomainEvent(
        new StockDisponible(this.id, tallaId, nuevoStock.cantidadDisponible),
      );
    }
  }

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
      modelName,
      modelBrand,
      modelBaseCode,
      modelMaterial,
    );
  }

  // ── Utilidades ──────────────────────────────

  private obtenerStockOError(tallaId: string): StockPorTalla {
    const stock = this._stockPorTalla.get(tallaId);
    if (!stock) {
      throw new Error(`Talla con ID ${tallaId} no está configurada para este producto`);
    }
    return stock;
  }
}
