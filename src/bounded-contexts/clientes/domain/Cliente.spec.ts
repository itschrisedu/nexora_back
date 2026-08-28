import { Cliente } from './Cliente';
import { Money } from '../../../shared/domain/Money';
import { NivelCredito } from './value-objects/NivelCredito';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';
import {
  CreditoNoPermitidoException,
  LimiteCreditoInsuficienteException,
  PermisoInsuficienteException,
} from './exceptions/ClienteExceptions';

describe('Cliente scoring and credit limits tests', () => {
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
      'client-1',
      'Juan',
      'Perez',
      '0999999999',
      'juan@gmail.com',
      null,
      null,
      'Calle Principal 123',
      'Notas del cliente',
    );
  });

  it('debe crearse correctamente con nivel SIN_CREDITO', () => {
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);
    expect(cliente.limiteCredito.amount).toBe(0);
    expect(cliente.totalCompras).toBe(0);
  });

  it('debe impedir asignar crédito a un cliente con menos de 9 compras', () => {
    // Intentar comprometer crédito (compras = 0)
    expect(() => cliente.comprometerCredito(Money.create(100))).toThrow(
      CreditoNoPermitidoException,
    );
  });

  it('debe mantener nivel SIN_CREDITO si completa menos de 10 compras', () => {
    // Registrar 9 compras
    for (let i = 0; i < 9; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    expect(cliente.totalCompras).toBe(9);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);

    // Intentar comprometer crédito (compras = 9) -> Ya tiene las 9 compras de contado requeridas.
    // Pero su nivel sigue siendo SIN_CREDITO (límite $0)
    expect(() => cliente.comprometerCredito(Money.create(50))).toThrow(
      CreditoNoPermitidoException, // Porque el nivel es SIN_CREDITO (límite $0)
    );
  });

  it('debe subir a NIVEL_1 (límite $300) al registrar 10 compras sin atrasos', () => {
    for (let i = 0; i < 10; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    expect(cliente.totalCompras).toBe(10);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_1);
    expect(cliente.limiteCredito.amount).toBe(300);

    // Los eventos de dominio deben reflejar el ascenso
    const events = cliente.domainEvents;
    expect(events.some((e) => e.eventName === 'NivelCreditoSubio')).toBe(true);
  });

  it('debe subir a NIVEL_2 (límite $700) al registrar 15 compras sin atrasos', () => {
    for (let i = 0; i < 15; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    expect(cliente.totalCompras).toBe(15);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_2);
    expect(cliente.limiteCredito.amount).toBe(700);
  });

  it('debe bajar de nivel en caso de atraso (ej: de NIVEL_3 a NIVEL_2)', () => {
    // Subir a NIVEL_3 (compras requeridas: 25)
    for (let i = 0; i < 25; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_3);
    expect(cliente.limiteCredito.amount).toBe(1500);

    // Registrar 1 atraso
    cliente.registrarAtraso(configs);

    // Baja a NIVEL_2 (límite $700)
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_2);
    expect(cliente.limiteCredito.amount).toBe(700);
    expect(cliente.atrasoConsecutivo).toBe(1);

    const events = cliente.domainEvents;
    expect(events.some((e) => e.eventName === 'NivelCreditoBajo')).toBe(true);
  });

  it('debe bajar de NIVEL_1 a SIN_CREDITO al registrar un atraso', () => {
    for (let i = 0; i < 10; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_1);

    cliente.registrarAtraso(configs);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);
    expect(cliente.limiteCredito.amount).toBe(0);
  });

  it('no debe fallar ni bajar de SIN_CREDITO en caso de atraso', () => {
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);

    cliente.registrarAtraso(configs);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);
    expect(cliente.limiteCredito.amount).toBe(0);
  });

  it('debe degradar a SIN_CREDITO si registra 2 atrasos consecutivos (de NIVEL_4 a SIN_CREDITO)', () => {
    // Llegar a NIVEL_4
    for (let i = 0; i < 40; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_4);
    expect(cliente.limiteCredito.amount).toBe(3000);

    // Atraso 1
    cliente.registrarAtraso(configs);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_3);
    expect(cliente.atrasoConsecutivo).toBe(1);

    // Atraso 2 (consecutivo)
    cliente.registrarAtraso(configs);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);
    expect(cliente.limiteCredito.amount).toBe(0);

    const events = cliente.domainEvents;
    expect(events.some((e) => e.eventName === 'ClienteDegradadoAContado')).toBe(true);
  });

  it('debe permitir comprometer y liberar crédito según los límites del cliente', () => {
    for (let i = 0; i < 10; i++) {
      cliente.registrarCompraCompletada(Money.create(50), false, configs);
    }
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_1); // $300 límite

    // Comprometer $100
    cliente.comprometerCredito(Money.create(100));
    expect(cliente.creditoUtilizado.amount).toBe(100);

    // Comprometer otros $150 (Total: 250)
    cliente.comprometerCredito(Money.create(150));
    expect(cliente.creditoUtilizado.amount).toBe(250);

    // Intentar comprometer $100 adicionales (Total: 350, supera 300) -> Excepción
    expect(() => cliente.comprometerCredito(Money.create(100))).toThrow(
      LimiteCreditoInsuficienteException,
    );

    // Liberar $100 (Total: 150)
    cliente.liberarCredito(Money.create(100));
    expect(cliente.creditoUtilizado.amount).toBe(150);

    // Ahora sí debe permitir comprometer otros $100 (Total: 250)
    cliente.comprometerCredito(Money.create(100));
    expect(cliente.creditoUtilizado.amount).toBe(250);
  });

  it('debe permitir ajustar nivel manualmente solo si el rol es ROL_ADMIN', () => {
    // Rol incorrecto lanza excepción
    expect(() =>
      cliente.ajustarNivelManualmente(
        NivelCredito.create(PrismaNivelCredito.NIVEL_3),
        'admin-1',
        'ROL_VENDEDOR',
        configs,
      ),
    ).toThrow(PermisoInsuficienteException);

    // Rol administrador es aprobado
    cliente.ajustarNivelManualmente(
      NivelCredito.create(PrismaNivelCredito.NIVEL_3),
      'admin-1',
      'ROL_ADMIN',
      configs,
    );

    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_3);
    expect(cliente.limiteCredito.amount).toBe(1500);
  });

  it('debe cumplir con un ciclo completo sin excepciones', () => {
    // 1. Registro (SIN_CREDITO, limite 0)
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);

    // 2. 10 compras completadas -> Sube a NIVEL_1 (limite 300)
    for (let i = 0; i < 10; i++) {
      cliente.registrarCompraCompletada(Money.create(100), false, configs);
    }
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_1);

    // 3. Atraso -> Baja a SIN_CREDITO (limite 0)
    cliente.registrarAtraso(configs);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);
  });
});
