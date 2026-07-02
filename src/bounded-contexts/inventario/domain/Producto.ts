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
  precioCostoAnterior: Money;
  precioVentaAnterior: Money;
  precioCostoNuevo: Money;
  precioVentaNuevo: Money;
  cambiadoPorId: string;
  motivo: string | null;
  createdAt: Date;
}

export class Producto extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private _codigo: string,
    private _nombre: string,
    private _marca: string,
    private _modelo: string,
    private _material: string | null,
    private _fotoUrl: string | null,
    private _precioCosto: Money,
    private _precioVenta: Money,
    private _serie: Serie,
    private _stockPorTalla: Map<string, StockPorTalla>,
    private _priceHistory: PriceHistoryEntry[] = [],
    private _activo: boolean = true,
  ) {
    super();
  }

  static crear(
    id: string,
    codigo: string,
    nombre: string,
    marca: string,
    modelo: string,
    material: string | null,
    fotoUrl: string | null,
    precioCosto: Money,
    precioVenta: Money,
    serie: Serie,
    stockPorTallaList: StockPorTalla[],
  ): Producto {
    if (precioCosto.amount <= 0 || precioVenta.amount <= 0) {
      throw new Error('Los precios de costo y venta deben ser mayores que cero');
    }

    const stockMap = new Map<string, StockPorTalla>();
    stockPorTallaList.forEach((s) => stockMap.set(s.tallaId, s));

    const producto = new Producto(
      id,
      codigo,
      nombre,
      marca,
      modelo,
      material,
      fotoUrl,
      precioCosto,
      precioVenta,
      serie,
      stockMap,
      [],
      true,
    );

    producto.addDomainEvent(new ProductoCreado(id, codigo, serie.value));

    return producto;
  }

  // ── Getters ─────────────────────────────────

  get id(): string {
    return this._id;
  }

  get codigo(): string {
    return this._codigo;
  }

  get nombre(): string {
    return this._nombre;
  }

  get marca(): string {
    return this._marca;
  }

  get modelo(): string {
    return this._modelo;
  }

  get material(): string | null {
    return this._material;
  }

  get fotoUrl(): string | null {
    return this._fotoUrl;
  }

  get precioCosto(): Money {
    return this._precioCosto;
  }

  get precioVenta(): Money {
    return this._precioVenta;
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

  get activo(): boolean {
    return this._activo;
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

    const anteriorCosto = this._precioCosto;
    const anteriorVenta = this._precioVenta;

    this._precioCosto = nuevoPrecioCosto;
    this._precioVenta = nuevoPrecioVenta;

    this._priceHistory.push({
      precioCostoAnterior: anteriorCosto,
      precioVentaAnterior: anteriorVenta,
      precioCostoNuevo: nuevoPrecioCosto,
      precioVentaNuevo: nuevoPrecioVenta,
      cambiadoPorId: userId,
      motivo: motivo || null,
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
    codigo: string,
    nombre: string,
    marca: string,
    modelo: string,
    material: string | null,
    fotoUrl: string | null,
    precioCosto: Money,
    precioVenta: Money,
    serie: Serie,
    stockPorTallaList: StockPorTalla[],
    historial: PriceHistoryEntry[],
    activo: boolean,
  ): Producto {
    const stockMap = new Map<string, StockPorTalla>();
    stockPorTallaList.forEach((s) => stockMap.set(s.tallaId, s));

    return new Producto(
      id,
      codigo,
      nombre,
      marca,
      modelo,
      material,
      fotoUrl,
      precioCosto,
      precioVenta,
      serie,
      stockMap,
      historial,
      activo,
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
