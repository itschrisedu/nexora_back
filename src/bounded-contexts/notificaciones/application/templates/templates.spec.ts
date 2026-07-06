import { pedidoConfirmadoTemplate } from './pedido-confirmado.template';
import { pedidoEnTransitoTemplate } from './pedido-en-transito.template';
import { pedidoEntregadoTemplate } from './pedido-entregado.template';
import { cobroVencidoTemplate } from './cobro-vencido.template';
import { notaVentaGeneradaTemplate } from './nota-venta-generada.template';

describe('Plantillas HTML de Notificaciones', () => {
  it('pedidoConfirmadoTemplate genera HTML con datos del pedido', () => {
    const html = pedidoConfirmadoTemplate({
      numeroPedido: 'ABC12345',
      clienteNombre: 'Juan Pérez',
      montoTotal: 150.5,
      tipoPago: 'CREDITO',
      lineas: [
        { producto: 'Nike Air Max', cantidad: 2, precioUnitario: 75.25 },
      ],
    });

    expect(html).toContain('ABC12345');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('$150.50');
    expect(html).toContain('CREDITO');
    expect(html).toContain('Nike Air Max');
    expect(html).toContain('NEXORA');
  });

  it('pedidoEnTransitoTemplate genera HTML con estado EN TRÁNSITO', () => {
    const html = pedidoEnTransitoTemplate({
      numeroPedido: 'DEF67890',
      clienteNombre: 'María López',
    });

    expect(html).toContain('DEF67890');
    expect(html).toContain('María López');
    expect(html).toContain('EN TRÁNSITO');
  });

  it('pedidoEntregadoTemplate genera HTML con monto final', () => {
    const html = pedidoEntregadoTemplate({
      numeroPedido: 'GHI11111',
      clienteNombre: 'Carlos Ruiz',
      montoFinal: 200,
    });

    expect(html).toContain('GHI11111');
    expect(html).toContain('$200.00');
    expect(html).toContain('Entregado');
  });

  it('cobroVencidoTemplate muestra severidad DANGER cuando > 15 días', () => {
    const html = cobroVencidoTemplate({
      clienteNombre: 'Pedro Gómez',
      cobroId: 'COBRO001',
      saldoPendiente: 500,
      diasVencido: 20,
    });

    expect(html).toContain('class="badge badge-danger"');
    expect(html).toContain('$500.00');
    expect(html).toContain('20 día(s)');
  });

  it('cobroVencidoTemplate muestra severidad WARNING cuando <= 15 días', () => {
    const html = cobroVencidoTemplate({
      clienteNombre: 'Ana Torres',
      cobroId: 'COBRO002',
      saldoPendiente: 100,
      diasVencido: 5,
    });

    expect(html).toContain('class="badge badge-warning"');
    expect(html).not.toContain('class="badge badge-danger"');
  });

  it('notaVentaGeneradaTemplate genera HTML con número y total', () => {
    const html = notaVentaGeneradaTemplate({
      clienteNombre: 'Luis Ríos',
      numeroNota: 42,
      total: 350.75,
    });

    expect(html).toContain('42');
    expect(html).toContain('$350.75');
    expect(html).toContain('Luis Ríos');
  });
});
