import { Producto } from './Producto';
import { Money } from '../../../shared/domain/Money';
import { Serie } from './value-objects/Serie';
import { StockPorTalla } from './value-objects/StockPorTalla';
import { TallaInvalidaParaSerieException } from './exceptions/TallaInvalidaParaSerieException';
import { SerieInvalidaException } from './exceptions/SerieInvalidaException';
import { Talla } from './value-objects/Talla';

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

  it('debe lanzar error si precio es negativo o cero', () => {
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

  it('debe lanzar SerieInvalidaException si la serie no es permitida', () => {
    expect(() => Serie.create('OTRA_SERIE_INVALIDA')).toThrow(
      SerieInvalidaException,
    );
  });

  it('debe lanzar TallaInvalidaParaSerieException si la talla no corresponde al rango de la serie', () => {
    expect(() => Talla.create(25, serieBebes)).toThrow(
      TallaInvalidaParaSerieException,
    );
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

  it('debe lanzar excepcion si cantidad disponible queda negativa al decrementar fisico', () => {
    const stock = StockPorTalla.create('t-id', 10, 5, 1);
    // Disponible = 5. Si descontamos 6 físicos, el stock disponible pasará a ser -1.
    expect(() => stock.disminuirFisico(6)).toThrow();
  });
});
