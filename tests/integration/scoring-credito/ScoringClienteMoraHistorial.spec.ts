import { Cliente } from '../../../src/bounded-contexts/clientes/domain/Cliente';
import { Money } from '../../../src/shared/domain/Money';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';
import { CreditoNoPermitidoException } from '../../../src/bounded-contexts/clientes/domain/exceptions/ClienteExceptions';

describe('Integración — Scoring y Alerta de Cliente con Historial de Mora', () => {
  const configs = [
    { nivel: PrismaNivelCredito.SIN_CREDITO, comprasRequeridas: 0, limiteDolares: 0 },
    { nivel: PrismaNivelCredito.NIVEL_1, comprasRequeridas: 10, limiteDolares: 300 },
    { nivel: PrismaNivelCredito.NIVEL_2, comprasRequeridas: 15, limiteDolares: 700 },
    { nivel: PrismaNivelCredito.NIVEL_3, comprasRequeridas: 25, limiteDolares: 1500 },
    { nivel: PrismaNivelCredito.NIVEL_4, comprasRequeridas: 40, limiteDolares: 3000 },
  ];

  let cliente: Cliente;

  beforeEach(() => {
    cliente = Cliente.crear(
      'client-moroso-1',
      'Carlos',
      'Mora Gomez',
      '0981122334',
      'carlos.mora@example.com',
      null,
      null,
      'Av. Cevallos y 24 de Mayo',
      'Cliente con historial de retrasos de pago',
    );
  });

  it('debe degradar automaticamente al cliente a SIN_CREDITO tras atrasos reiterados (>= 2 consecutivos)', () => {
    // 1. Cliente acumula 10 compras y asciende a NIVEL_1 ($300 cupo)
    for (let i = 0; i < 10; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_1);
    expect(cliente.limiteCredito.amount).toBe(300);

    // 2. Primer atraso -> baja un nivel pero NO a SIN_CREDITO aun
    cliente.registrarAtraso(configs);
    expect(cliente.atrasoConsecutivo).toBe(1);

    // 3. Segundo atraso consecutivo -> ahora SI cae a SIN_CREDITO
    cliente.registrarAtraso(configs);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);
    expect(cliente.limiteCredito.amount).toBe(0);
    expect(cliente.atrasoConsecutivo).toBe(2);

    // 4. Se emite evento de dominio: "ClienteDegradadoAContado"
    const eventos = cliente.domainEvents;
    expect(eventos.some((e) => e.eventName === 'ClienteDegradadoAContado')).toBe(true);

    // 5. Si intenta solicitar credito, el sistema lo bloquea
    expect(() => cliente.comprometerCredito(Money.create(150))).toThrow(
      CreditoNoPermitidoException,
    );
  });

  it('debe mantener en SIN_CREDITO incluso tras saldar deuda pendiente, sin permitir nueva compra a credito', () => {
    // Ascenso a NIVEL_1
    for (let i = 0; i < 10; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }

    // Dos atrasos consecutivos -> SIN_CREDITO
    cliente.registrarAtraso(configs);
    cliente.registrarAtraso(configs);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);

    // Cliente salda su saldo pendiente (pago tardio completado)
    cliente.liberarCredito(Money.create(0));

    // El sistema continua exigiendole venta exclusiva de contado ($0 de credito)
    expect(cliente.limiteCredito.amount).toBe(0);
    expect(() => cliente.comprometerCredito(Money.create(50))).toThrow(
      CreditoNoPermitidoException,
    );
  });

  it('debe registrar correctamente la rehabilitacion por ajuste manual del administrador', () => {
    // Ascenso a NIVEL_1 y doble atraso
    for (let i = 0; i < 10; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    cliente.registrarAtraso(configs);
    cliente.registrarAtraso(configs);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);

    // Admin rehabilita manualmente al NIVEL_1
    const { NivelCredito } = require('../../../src/bounded-contexts/clientes/domain/value-objects/NivelCredito');
    const nivelRehabilitado = NivelCredito.create(PrismaNivelCredito.NIVEL_1);
    cliente.ajustarNivelManualmente(nivelRehabilitado, 'admin-01', 'ROL_ADMIN', configs);

    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_1);
    expect(cliente.limiteCredito.amount).toBe(300);
    expect(cliente.atrasoConsecutivo).toBe(0);

    // Ahora SI puede comprometer credito
    expect(() => cliente.comprometerCredito(Money.create(100))).not.toThrow();
  });
});
