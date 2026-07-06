import {
  SupplierOrder,
  SupplierOrderSinLineasException,
  CantidadPedidaInvalidaException,
  PrecioCostoInvalidoException,
  EstadoOrdenInvalidoException,
} from './SupplierOrder';
import { SupplierOrderStatus } from '@prisma/client';

describe('SupplierOrder Aggregate Root', () => {
  const orderId = 'order-1';
  const numero = 100;
  const supplierId = 'sup-1';
  const lines = [
    { id: 'line-1', productId: 'prod-1', cantidadPedida: 10, precioCosto: 15.5 },
    { id: 'line-2', productId: 'prod-2', cantidadPedida: 5, precioCosto: 20.0 },
  ];

  describe('crear', () => {
    it('debe inicializar la orden de compra correctamente en PENDIENTE', () => {
      const order = SupplierOrder.crear(orderId, numero, supplierId, lines);

      expect(order.id).toBe(orderId);
      expect(order.numero).toBe(numero);
      expect(order.supplierId).toBe(supplierId);
      expect(order.total).toBe(10 * 15.5 + 5 * 20.0); // 255.0
      expect(order.estado).toBe(SupplierOrderStatus.PENDIENTE);
      expect(order.lines).toHaveLength(2);
      expect(order.lines[0].subtotal).toBe(155.0);

      const events = order.domainEvents;
      expect(events.some((e) => e.eventName === 'SupplierOrderCreado')).toBe(true);
    });

    it('debe lanzar exception si se crea sin líneas', () => {
      expect(() => {
        SupplierOrder.crear(orderId, numero, supplierId, []);
      }).toThrow(SupplierOrderSinLineasException);
    });

    it('debe lanzar exception si alguna cantidad pedida es menor o igual a 0', () => {
      const invalidLines = [
        { id: 'line-1', productId: 'prod-1', cantidadPedida: 0, precioCosto: 15.5 },
      ];
      expect(() => {
        SupplierOrder.crear(orderId, numero, supplierId, invalidLines);
      }).toThrow(CantidadPedidaInvalidaException);
    });

    it('debe lanzar exception si algún precio costo es menor o igual a 0', () => {
      const invalidLines = [
        { id: 'line-1', productId: 'prod-1', cantidadPedida: 5, precioCosto: -1.0 },
      ];
      expect(() => {
        SupplierOrder.crear(orderId, numero, supplierId, invalidLines);
      }).toThrow(PrecioCostoInvalidoException);
    });
  });

  describe('transición de estados', () => {
    it('debe marcar como recibida una orden pendiente', () => {
      const order = SupplierOrder.crear(orderId, numero, supplierId, lines);
      order.marcarComoRecibida();

      expect(order.estado).toBe(SupplierOrderStatus.RECIBIDA);
      const events = order.domainEvents;
      expect(events.some((e) => e.eventName === 'SupplierOrderRecibido')).toBe(true);
    });

    it('debe cancelar una orden pendiente', () => {
      const order = SupplierOrder.crear(orderId, numero, supplierId, lines);
      order.cancelar();

      expect(order.estado).toBe(SupplierOrderStatus.CANCELADA);
    });

    it('debe lanzar exception al intentar cancelar una orden recibida', () => {
      const order = SupplierOrder.crear(orderId, numero, supplierId, lines);
      order.marcarComoRecibida();

      expect(() => {
        order.cancelar();
      }).toThrow(EstadoOrdenInvalidoException);
    });
  });
});
