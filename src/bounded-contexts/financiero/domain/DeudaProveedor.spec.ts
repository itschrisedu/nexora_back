import { DeudaProveedor, DeudaYaSaldadaException, PagoSuperaDeudaException } from './DeudaProveedor';
import { Money } from '../../../shared/domain/Money';
import { DeudaEstado } from '@prisma/client';

describe('DeudaProveedor Aggregate Root', () => {
  const deudaId = 'deu-123';
  const supplierId = 'sup-123';
  const entradaId = 'ent-123';
  const total = Money.create(500);
  const fechaVencimiento = new Date();

  describe('crear', () => {
    it('debe inicializarse correctamente como PENDIENTE', () => {
      const deuda = DeudaProveedor.crear(deudaId, supplierId, entradaId, total, fechaVencimiento);

      expect(deuda.id).toBe(deudaId);
      expect(deuda.supplierId).toBe(supplierId);
      expect(deuda.entradaId).toBe(entradaId);
      expect(deuda.montoTotal.amount).toBe(500);
      expect(deuda.saldoPendiente.amount).toBe(500);
      expect(deuda.estado).toBe(DeudaEstado.PENDIENTE);
      expect(deuda.fechaVencimiento).toEqual(fechaVencimiento);

      const events = deuda.domainEvents;
      expect(events.some(e => e.eventName === 'DeudaProveedorCreada')).toBe(true);
    });
  });

  describe('registrarPago', () => {
    it('debe registrar un pago parcial', () => {
      const deuda = DeudaProveedor.crear(deudaId, supplierId, entradaId, total, fechaVencimiento);

      deuda.registrarPago('pago-1', Money.create(200), 'TRANSFERENCIA', 'user-1', 'Primer pago a prov');

      expect(deuda.saldoPendiente.amount).toBe(300);
      expect(deuda.estado).toBe(DeudaEstado.PARCIALMENTE_PAGADO);
      expect(deuda.pagos).toHaveLength(1);
      expect(deuda.pagos[0].monto.amount).toBe(200);
      expect(deuda.pagos[0].metodo).toBe('TRANSFERENCIA');
    });

    it('debe saldar la deuda cuando el pago cubra el total', () => {
      const deuda = DeudaProveedor.crear(deudaId, supplierId, entradaId, total, fechaVencimiento);

      deuda.registrarPago('pago-1', Money.create(500), 'CHEQUE', 'user-1');

      expect(deuda.saldoPendiente.amount).toBe(0);
      expect(deuda.estado).toBe(DeudaEstado.SALDADO);
      expect(deuda.domainEvents.some(e => e.eventName === 'DeudaProveedorSaldada')).toBe(true);
    });

    it('debe lanzar error si el pago supera la deuda pendiente', () => {
      const deuda = DeudaProveedor.crear(deudaId, supplierId, entradaId, total, fechaVencimiento);

      expect(() => {
        deuda.registrarPago('pago-1', Money.create(501), 'EFECTIVO', 'user-1');
      }).toThrow(PagoSuperaDeudaException);
    });

    it('debe lanzar error al intentar pagar una deuda ya saldada', () => {
      const deuda = DeudaProveedor.crear(deudaId, supplierId, entradaId, total, fechaVencimiento);
      deuda.registrarPago('pago-1', Money.create(500), 'EFECTIVO', 'user-1');

      expect(() => {
        deuda.registrarPago('pago-2', Money.create(10), 'EFECTIVO', 'user-1');
      }).toThrow(DeudaYaSaldadaException);
    });
  });
});
