import { Cobro, CobroYaSaldadoException, AbonoPorEncimaSaldoException } from './Cobro';
import { Money } from '../../../shared/domain/Money';
import { CobroEstado, TipoCobro } from '@prisma/client';

describe('Cobro Aggregate Root', () => {
  const cobroId = 'cob-123';
  const saleNoteId = 'sn-123';
  const clientId = 'cli-123';
  const total = Money.create(100);

  describe('crearContado', () => {
    it('debe crear un cobro al contado saldado inmediatamente', () => {
      const cobro = Cobro.crearContado(cobroId, saleNoteId, clientId, total);

      expect(cobro.id).toBe(cobroId);
      expect(cobro.saleNoteId).toBe(saleNoteId);
      expect(cobro.clientId).toBe(clientId);
      expect(cobro.tipo).toBe(TipoCobro.CONTADO);
      expect(cobro.montoTotal.amount).toBe(100);
      expect(cobro.saldoPendiente.amount).toBe(0);
      expect(cobro.estado).toBe(CobroEstado.SALDADO);
      expect(cobro.fechaVencimiento).toBeNull();
      
      const events = cobro.domainEvents;
      expect(events.some(e => e.eventName === 'CobroCreado')).toBe(true);
      expect(events.some(e => e.eventName === 'DeudaSaldada')).toBe(true);
    });
  });

  describe('crearCredito', () => {
    it('debe crear un cobro a crédito pendiente de pago', () => {
      const fechaVencimiento = new Date();
      fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
      
      const cobro = Cobro.crearCredito(cobroId, saleNoteId, clientId, total, fechaVencimiento);

      expect(cobro.tipo).toBe(TipoCobro.CREDITO);
      expect(cobro.saldoPendiente.amount).toBe(100);
      expect(cobro.estado).toBe(CobroEstado.PENDIENTE);
      expect(cobro.fechaVencimiento).toEqual(fechaVencimiento);
    });
  });

  describe('registrarAbono', () => {
    it('debe registrar un abono parcial y cambiar estado a PARCIALMENTE_PAGADO', () => {
      const fechaVencimiento = new Date();
      const cobro = Cobro.crearCredito(cobroId, saleNoteId, clientId, total, fechaVencimiento);

      cobro.registrarAbono('abono-1', Money.create(40), 'EFECTIVO', 'user-1', 'Primer pago');

      expect(cobro.saldoPendiente.amount).toBe(60);
      expect(cobro.estado).toBe(CobroEstado.PARCIALMENTE_PAGADO);
      expect(cobro.abonos).toHaveLength(1);
      expect(cobro.abonos[0].monto.amount).toBe(40);
      expect(cobro.abonos[0].metodo).toBe('EFECTIVO');
    });

    it('debe saldar el cobro cuando los abonos cubran la totalidad de la deuda', () => {
      const fechaVencimiento = new Date();
      const cobro = Cobro.crearCredito(cobroId, saleNoteId, clientId, total, fechaVencimiento);

      cobro.registrarAbono('abono-1', Money.create(40), 'EFECTIVO', 'user-1');
      cobro.registrarAbono('abono-2', Money.create(60), 'TRANSFERENCIA', 'user-1');

      expect(cobro.saldoPendiente.amount).toBe(0);
      expect(cobro.estado).toBe(CobroEstado.SALDADO);
      expect(cobro.domainEvents.some(e => e.eventName === 'DeudaSaldada')).toBe(true);
    });

    it('debe lanzar error si el abono supera el saldo pendiente', () => {
      const fechaVencimiento = new Date();
      const cobro = Cobro.crearCredito(cobroId, saleNoteId, clientId, total, fechaVencimiento);

      expect(() => {
        cobro.registrarAbono('abono-1', Money.create(110), 'EFECTIVO', 'user-1');
      }).toThrow(AbonoPorEncimaSaldoException);
    });

    it('debe lanzar error al intentar abonar a un cobro ya saldado', () => {
      const cobro = Cobro.crearContado(cobroId, saleNoteId, clientId, total);

      expect(() => {
        cobro.registrarAbono('abono-1', Money.create(10), 'EFECTIVO', 'user-1');
      }).toThrow(CobroYaSaldadoException);
    });
  });
});
