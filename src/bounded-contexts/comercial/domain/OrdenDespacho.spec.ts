import { OrdenDespacho, PermisoInsuficienteDespachoException } from './OrdenDespacho';
import { DispatchEstado } from '@prisma/client';

describe('OrdenDespacho — Aggregate Root', () => {
  const lineasMock = [
    {
      id: 'line-1',
      productId: 'prod-001',
      serieId: 'serie-001',
      tallaId: 'talla-38',
      cantidad: 5,
    },
  ];

  it('debe crear una orden de despacho correctamente', () => {
    const orden = OrdenDespacho.crear('dispatch-1', 'order-1', lineasMock);

    expect(orden.id).toBe('dispatch-1');
    expect(orden.orderId).toBe('order-1');
    expect(orden.estado).toBe(DispatchEstado.PENDIENTE_SEPARACION);
    expect(orden.lines.length).toBe(1);
    expect(orden.lines[0].aceptada).toBe(true);
    expect(orden.confirmadoPorId).toBeNull();
  });

  it('debe permitir confirmar la separación por ROL_BODEGUERO', () => {
    const orden = OrdenDespacho.crear('dispatch-1', 'order-1', lineasMock);
    orden.confirmarSeparacion('user-bodega', 'ROL_BODEGUERO');

    expect(orden.estado).toBe(DispatchEstado.SEPARADO);
    expect(orden.confirmadoPorId).toBe('user-bodega');
    expect(orden.confirmadoAt).toBeInstanceOf(Date);

    const events = orden.domainEvents;
    expect(events.length).toBe(1);
    expect(events[0].eventName).toBe('SeparacionConfirmadaPorBodega');
  });

  it('debe permitir confirmar la separación por ROL_ADMIN', () => {
    const orden = OrdenDespacho.crear('dispatch-1', 'order-1', lineasMock);
    orden.confirmarSeparacion('user-admin', 'ROL_ADMIN');

    expect(orden.estado).toBe(DispatchEstado.SEPARADO);
  });

  it('debe lanzar excepcion si un ROL_VENDEDOR intenta confirmar la separación', () => {
    const orden = OrdenDespacho.crear('dispatch-1', 'order-1', lineasMock);

    expect(() =>
      orden.confirmarSeparacion('user-vendedor', 'ROL_VENDEDOR'),
    ).toThrow(PermisoInsuficienteDespachoException);
  });

  it('debe permitir transicionar a EN_TRANSITO desde SEPARADO', () => {
    const orden = OrdenDespacho.crear('dispatch-1', 'order-1', lineasMock);
    orden.confirmarSeparacion('user-bodega', 'ROL_BODEGUERO');
    orden.marcarEnTransito();

    expect(orden.estado).toBe(DispatchEstado.EN_TRANSITO);
  });

  it('debe lanzar error al marcar en transito si no ha sido separado', () => {
    const orden = OrdenDespacho.crear('dispatch-1', 'order-1', lineasMock);

    expect(() => orden.marcarEnTransito()).toThrow(
      'No se puede marcar en tránsito: el despacho debe estar SEPARADO',
    );
  });
});
