import { Producto } from '../../../src/bounded-contexts/inventario/domain/Producto';
import { Money } from '../../../src/shared/domain/Money';
import { Serie } from '../../../src/bounded-contexts/inventario/domain/value-objects/Serie';
import { StockPorTalla } from '../../../src/bounded-contexts/inventario/domain/value-objects/StockPorTalla';
import { Talla } from '../../../src/bounded-contexts/inventario/domain/value-objects/Talla';

describe('Producto Aggregate Root', () => {
  let serieBebes: Serie;
  let talla18: StockPorTalla;
  let talla19: StockPorTalla;

  beforeEach(() => {
    serieBebes = Serie.create('BEBE');
    talla18 = StockPorTalla.create('talla-18-id', 10, 0, 2);
    talla19 = StockPorTalla.create('talla-19-id', 5, 0, 1);
  });

  it('debe crear un producto correctamente con datos válidos', () => {
    const producto = Producto.crear(
      'prod-uuid',
      'model-uuid',
      'COD-001',
      'Blanco',
      'http://imagen.jpg',
      Money.create(15.5),
      Money.create(25.99),
      serieBebes,
      [talla18, talla19],
    );

    expect(producto.id).toBe('prod-uuid');
    expect(producto.codigo).toBe('COD-001');
    expect(producto.precioVenta.amount).toBe(25.99);
    expect(producto.stockPorTalla.size).toBe(2);
    expect(producto.domainEvents.length).toBeGreaterThan(0);
    expect(producto.domainEvents[0].eventName).toBe('inventario.producto_creado');
  });

  it('debe lanzar error si precio de venta o costo es menor o igual a cero', () => {
    expect(() =>
      Producto.crear(
        'prod-uuid',
        'model-uuid',
        'COD-001',
        'Blanco',
        null,
        Money.create(0),
        Money.create(10),
        serieBebes,
        [talla18],
      ),
    ).toThrow();
  });

  it('debe lanzar error si la serie está vacía', () => {
    expect(() => Serie.create('')).toThrow();
  });

  it('debe lanzar error si el número de talla es menor o igual a 0', () => {
    expect(() => Talla.create(0, serieBebes)).toThrow();
    expect(() => Talla.create(-5, serieBebes)).toThrow();
  });

  it('debe cambiar de precio y registrarlo en el historial de precios', () => {
    const producto = Producto.crear(
      'prod-uuid',
      'model-uuid',
      'COD-001',
      'Blanco',
      null,
      Money.create(10),
      Money.create(20),
      serieBebes,
      [talla18],
    );

    producto.cambiarPrecio(Money.create(12), Money.create(24), 'admin-user-id', 'Ajuste de inflación');

    expect(producto.precioVenta.amount).toBe(24);
    expect(producto.precioCosto.amount).toBe(12);
    expect(producto.priceHistory).toHaveLength(1);
    expect(producto.priceHistory[0].newSalePrice.amount).toBe(24);
    expect(producto.priceHistory[0].reason).toBe('Ajuste de inflación');
  });

  it('debe permitir reservar stock si hay disponibilidad física suficiente', () => {
    const producto = Producto.crear(
      'prod-uuid',
      'model-uuid',
      'COD-001',
      'Blanco',
      null,
      Money.create(10),
      Money.create(20),
      serieBebes,
      [talla18],
    );

    producto.reservarStock('talla-18-id', 4, 'reserva-001', new Date());

    const stock = producto.stockPorTalla.get('talla-18-id')!;
    expect(stock.cantidadReservada).toBe(4);
    expect(stock.cantidadDisponible).toBe(6);
  });

  it('debe lanzar excepcion si se reserva mas stock del disponible', () => {
    const producto = Producto.crear(
      'prod-uuid',
      'model-uuid',
      'COD-001',
      'Blanco',
      null,
      Money.create(10),
      Money.create(20),
      serieBebes,
      [talla18],
    );

    expect(() =>
      producto.reservarStock('talla-18-id', 11, 'reserva-001', new Date()),
    ).toThrow();
  });

  it('debe lanzar excepcion si cantidad física a decrementar supera el total', () => {
    const producto = Producto.crear(
      'prod-uuid',
      'model-uuid',
      'COD-001',
      'Blanco',
      null,
      Money.create(10),
      Money.create(20),
      serieBebes,
      [talla18],
    );
    expect(() => producto.descontarStock('talla-18-id', 15)).toThrow(
      'No es posible descontar más de la cantidad física real',
    );
  });
});
