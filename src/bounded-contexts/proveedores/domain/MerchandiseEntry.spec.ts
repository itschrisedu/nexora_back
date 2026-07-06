import {
  MerchandiseEntry,
  MerchandiseEntrySinLineasException,
  CantidadIngresadaInvalidaException,
  PrecioCostoEntryInvalidoException,
} from './MerchandiseEntry';

describe('MerchandiseEntry Aggregate Root', () => {
  const entryId = 'entry-1';
  const numero = 500;
  const supplierId = 'sup-1';
  const lines = [
    { id: 'line-1', productId: 'prod-1', tallaId: 't-38', cantidadIngresada: 12, precioCosto: 10.0 },
    { id: 'line-2', productId: 'prod-2', tallaId: 't-39', cantidadIngresada: 6, precioCosto: 20.0 },
  ];

  describe('crear', () => {
    it('debe registrar el ingreso físico correctamente y disparar evento de integración', () => {
      const entry = MerchandiseEntry.crear(entryId, numero, supplierId, lines, 'order-123');

      expect(entry.id).toBe(entryId);
      expect(entry.numero).toBe(numero);
      expect(entry.supplierId).toBe(supplierId);
      expect(entry.supplierOrderId).toBe('order-123');
      expect(entry.total).toBe(12 * 10.0 + 6 * 20.0); // 240.0
      expect(entry.lines).toHaveLength(2);
      expect(entry.lines[0].subtotal).toBe(120.0);

      const events = entry.domainEvents;
      const registeredEvent = events.find((e) => e.eventName === 'MerchandiseEntryRegistrada');
      expect(registeredEvent).toBeDefined();
      
      const payload: any = registeredEvent?.toPrimitives();
      expect(payload.lines).toHaveLength(2);
      expect(payload.lines[0].cantidadIngresada).toBe(12);
    });

    it('debe lanzar exception si se crea sin líneas', () => {
      expect(() => {
        MerchandiseEntry.crear(entryId, numero, supplierId, []);
      }).toThrow(MerchandiseEntrySinLineasException);
    });

    it('debe lanzar exception si alguna cantidad ingresada es menor o igual a 0', () => {
      const invalidLines = [
        { id: 'line-1', productId: 'prod-1', tallaId: 't-38', cantidadIngresada: 0, precioCosto: 10.0 },
      ];
      expect(() => {
        MerchandiseEntry.crear(entryId, numero, supplierId, invalidLines);
      }).toThrow(CantidadIngresadaInvalidaException);
    });

    it('debe lanzar exception si algún precio costo es menor o igual a 0', () => {
      const invalidLines = [
        { id: 'line-1', productId: 'prod-1', tallaId: 't-38', cantidadIngresada: 5, precioCosto: 0 },
      ];
      expect(() => {
        MerchandiseEntry.crear(entryId, numero, supplierId, invalidLines);
      }).toThrow(PrecioCostoEntryInvalidoException);
    });
  });
});
