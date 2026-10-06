import { Pedido } from '../../../src/bounded-contexts/comercial/domain/Pedido';
import { LineaPedido } from '../../../src/bounded-contexts/comercial/domain/LineaPedido';
import { OrdenDespacho } from '../../../src/bounded-contexts/comercial/domain/OrdenDespacho';
import { CanalEntrada, PrismaCanalEntrada } from '../../../src/bounded-contexts/comercial/domain/value-objects/CanalEntrada';
import { TipoPago, PrismaTipoPago } from '../../../src/bounded-contexts/comercial/domain/value-objects/TipoPago';
import { TipoVenta, PrismaTipoVenta } from '../../../src/bounded-contexts/comercial/domain/value-objects/TipoVenta';
import { Money } from '../../../src/shared/domain/Money';
import { PrismaEstadoPedido } from '../../../src/bounded-contexts/comercial/domain/value-objects/EstadoPedido';
import { DispatchEstado } from '@prisma/client';

describe('Integración — Ciclo Comercial Completo (Pedido -> Despacho -> Entrega)', () => {
  const clienteId = 'client-123';
  const usuarioVentas = 'user-vendedor-1';
  const usuarioBodega = 'user-bodeguero-1';

  it('debe ejecutar el flujo completo desde creacion de pedido hasta despacho y entrega', () => {
    // 1. Crear lineas con Curva de Tallas
    const linea1 = LineaPedido.crear(
      'line-1',
      'prod-mocasin-01',
      'serie-caballero',
      'talla-39',
      2,
      Money.create(35),
      TipoVenta.create(PrismaTipoVenta.TALLA_ESPECIFICA),
    );

    const linea2 = LineaPedido.crear(
      'line-2',
      'prod-mocasin-01',
      'serie-caballero',
      'talla-40',
      1,
      Money.create(35),
      TipoVenta.create(PrismaTipoVenta.TALLA_ESPECIFICA),
    );

    // 2. Crear Pedido en estado PENDIENTE
    const pedido = Pedido.crear(
      'order-101',
      clienteId,
      CanalEntrada.create(PrismaCanalEntrada.MANUAL),
      TipoPago.create(PrismaTipoPago.CONTADO),
      [linea1, linea2],
      PrismaEstadoPedido.PENDIENTE,
      usuarioVentas,
    );

    expect(pedido.id).toBe('order-101');
    expect(pedido.montoTotal.amount).toBe(105);
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.PENDIENTE);

    // 3. Generar Orden de Despacho para Bodega
    const lineasDespacho = pedido.lineas.map((it) => ({
      id: `disp-line-${it.id}`,
      productId: it.productId,
      serieId: it.serieId,
      tallaId: it.tallaId,
      cantidad: it.cantidad,
    }));

    const ordenDespacho = OrdenDespacho.crear('dispatch-101', pedido.id, lineasDespacho);
    expect(ordenDespacho.estado).toBe(DispatchEstado.PENDIENTE_SEPARACION);

    // 4. Bodega confirma separacion fisica del calzado
    ordenDespacho.confirmarSeparacion(usuarioBodega, 'ROL_BODEGUERO');
    expect(ordenDespacho.estado).toBe(DispatchEstado.SEPARADO);
    expect(ordenDespacho.confirmadoPorId).toBe(usuarioBodega);

    // 5. Salida en transito
    ordenDespacho.marcarEnTransito();
    expect(ordenDespacho.estado).toBe(DispatchEstado.EN_TRANSITO);

    // 6. Transicion del Pedido por sus fases reales
    pedido.iniciarPreparacion();
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.EN_PREPARACION);

    pedido.marcarEnTransito();
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.EN_TRANSITO);

    pedido.confirmarEntrega();
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.ENTREGADO);

    // 7. Verificar que se emitio el evento de entrega
    expect(
      pedido.domainEvents.some((e) => e.eventName === 'PedidoEntregado'),
    ).toBe(true);
  });

  it('debe rechazar despacho si el rol no es bodeguero ni admin', () => {
    const linea = LineaPedido.crear(
      'line-1',
      'prod-01',
      'serie-01',
      'talla-38',
      1,
      Money.create(40),
      TipoVenta.create(PrismaTipoVenta.TALLA_ESPECIFICA),
    );

    const pedido = Pedido.crear(
      'order-102',
      clienteId,
      CanalEntrada.create(PrismaCanalEntrada.MANUAL),
      TipoPago.create(PrismaTipoPago.CONTADO),
      [linea],
      PrismaEstadoPedido.PENDIENTE,
      usuarioVentas,
    );

    const orden = OrdenDespacho.crear('dispatch-102', pedido.id, [
      { id: 'dl-1', productId: 'prod-01', serieId: 'serie-01', tallaId: 'talla-38', cantidad: 1 },
    ]);

    expect(() => orden.confirmarSeparacion('user-vendedor-1', 'ROL_VENDEDOR')).toThrow(
      'no tiene permiso',
    );
  });

  it('debe cancelar un pedido y emitir evento de cancelacion', () => {
    const linea = LineaPedido.crear(
      'line-1',
      'prod-01',
      'serie-01',
      'talla-39',
      3,
      Money.create(30),
      TipoVenta.create(PrismaTipoVenta.TALLA_ESPECIFICA),
    );

    const pedido = Pedido.crear(
      'order-103',
      clienteId,
      CanalEntrada.create(PrismaCanalEntrada.MANUAL),
      TipoPago.create(PrismaTipoPago.CREDITO),
      [linea],
      PrismaEstadoPedido.PENDIENTE,
      usuarioVentas,
    );

    pedido.cancelar('Cliente solicito anulacion');
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.CANCELADO);
    expect(
      pedido.domainEvents.some((e) => e.eventName === 'PedidoCancelado'),
    ).toBe(true);
  });
});
