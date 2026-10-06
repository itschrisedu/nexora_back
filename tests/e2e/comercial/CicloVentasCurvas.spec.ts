import { Pedido } from '../../../src/bounded-contexts/comercial/domain/Pedido';
import { LineaPedido } from '../../../src/bounded-contexts/comercial/domain/LineaPedido';
import { OrdenDespacho } from '../../../src/bounded-contexts/comercial/domain/OrdenDespacho';
import { CanalEntrada, PrismaCanalEntrada } from '../../../src/bounded-contexts/comercial/domain/value-objects/CanalEntrada';
import { TipoPago, PrismaTipoPago } from '../../../src/bounded-contexts/comercial/domain/value-objects/TipoPago';
import { TipoVenta, PrismaTipoVenta } from '../../../src/bounded-contexts/comercial/domain/value-objects/TipoVenta';
import { Money } from '../../../src/shared/domain/Money';
import { PrismaEstadoPedido } from '../../../src/bounded-contexts/comercial/domain/value-objects/EstadoPedido';
import { DispatchEstado } from '@prisma/client';

describe('E2E / Sistema — Flujo Integral de Pedido con Curva de Tallas, Despacho y Entrega', () => {
  const clienteMayoristaId = 'cli-mayorista-cevallos';
  const vendedorId = 'usr-vendedor-01';
  const bodegueroId = 'usr-bodega-01';

  it('debe simular el ciclo E2E completo de compra por docenas de calzado', () => {
    // 1. Configuración de líneas por curva de tallas (1 Docena = 12 pares de Botín Londres)
    const lineasCurvaDocena = [
      LineaPedido.crear('l-38', 'mod-londres', 'serie-adulto', 'talla-38', 2, Money.create(18.5), TipoVenta.create(PrismaTipoVenta.SERIE_COMPLETA)),
      LineaPedido.crear('l-39', 'mod-londres', 'serie-adulto', 'talla-39', 3, Money.create(18.5), TipoVenta.create(PrismaTipoVenta.SERIE_COMPLETA)),
      LineaPedido.crear('l-40', 'mod-londres', 'serie-adulto', 'talla-40', 3, Money.create(18.5), TipoVenta.create(PrismaTipoVenta.SERIE_COMPLETA)),
      LineaPedido.crear('l-41', 'mod-londres', 'serie-adulto', 'talla-41', 2, Money.create(18.5), TipoVenta.create(PrismaTipoVenta.SERIE_COMPLETA)),
      LineaPedido.crear('l-42', 'mod-londres', 'serie-adulto', 'talla-42', 2, Money.create(18.5), TipoVenta.create(PrismaTipoVenta.SERIE_COMPLETA)),
    ];

    const totalPares = lineasCurvaDocena.reduce((acc, l) => acc + l.cantidad, 0);
    expect(totalPares).toBe(12);

    // 2. Emisión de Pedido
    const pedido = Pedido.crear(
      'ped-2026-001',
      clienteMayoristaId,
      CanalEntrada.create(PrismaCanalEntrada.MANUAL),
      TipoPago.create(PrismaTipoPago.CONTADO),
      lineasCurvaDocena,
      PrismaEstadoPedido.PENDIENTE,
      vendedorId,
    );

    expect(pedido.id).toBe('ped-2026-001');
    expect(pedido.montoTotal.amount).toBe(222.0); // 12 pares * $18.50 = $222.00
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.PENDIENTE);

    // 3. Preparación en Bodega
    pedido.iniciarPreparacion();
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.EN_PREPARACION);

    // 4. Creación y Confirmación de Orden de Despacho
    const lineasDespacho = pedido.lineas.map((l) => ({
      id: `disp-${l.id}`,
      productId: l.productId,
      serieId: l.serieId,
      tallaId: l.tallaId,
      cantidad: l.cantidad,
    }));

    const ordenDespacho = OrdenDespacho.crear(
      'disp-001',
      pedido.id,
      lineasDespacho,
    );

    expect(ordenDespacho.estado).toBe(DispatchEstado.PENDIENTE_SEPARACION);

    ordenDespacho.confirmarSeparacion(bodegueroId, 'ROL_BODEGUERO');
    expect(ordenDespacho.estado).toBe(DispatchEstado.SEPARADO);

    // 5. Tránsito y Entrega final al cliente
    ordenDespacho.marcarEnTransito();
    pedido.marcarEnTransito();
    expect(ordenDespacho.estado).toBe(DispatchEstado.EN_TRANSITO);
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.EN_TRANSITO);

    pedido.confirmarEntrega();
    expect(pedido.estado.value).toBe(PrismaEstadoPedido.ENTREGADO);
  });
});
