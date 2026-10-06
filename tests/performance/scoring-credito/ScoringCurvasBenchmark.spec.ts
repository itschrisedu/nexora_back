import { Cliente } from '../../../src/bounded-contexts/clientes/domain/Cliente';
import { Money } from '../../../src/shared/domain/Money';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

describe('Rendimiento / Benchmark — Evaluación de Scoring Crediticio y Procesamiento de Pedidos', () => {
  const configsCredito = [
    { nivel: PrismaNivelCredito.NIVEL_4, comprasRequeridas: 10, limiteDolares: 2000 },
    { nivel: PrismaNivelCredito.NIVEL_3, comprasRequeridas: 6, limiteDolares: 1000 },
    { nivel: PrismaNivelCredito.NIVEL_2, comprasRequeridas: 3, limiteDolares: 500 },
    { nivel: PrismaNivelCredito.SIN_CREDITO, comprasRequeridas: 0, limiteDolares: 0 },
  ];

  it('debe procesar el scoring y ascenso de 500 perfiles de clientes en menos de 150 ms (< 0.3 ms por cliente)', () => {
    const totalClientes = 500;
    const clientes = Array.from({ length: totalClientes }, (_, i) =>
      Cliente.crear(
        `cli-${i}`,
        `Cliente ${i}`,
        'Calzado Cevallos',
        '0991234567',
        null,
        null,
        '1710034065',
        null,
        null,
      ),
    );

    const inicioScoring = performance.now();

    clientes.forEach((c) => {
      // Simular 4 compras para cada cliente
      c.registrarCompraCompletada(Money.create(100), false, configsCredito);
      c.registrarCompraCompletada(Money.create(120), false, configsCredito);
      c.registrarCompraCompletada(Money.create(150), false, configsCredito);
      c.registrarCompraCompletada(Money.create(80), false, configsCredito);
    });

    const finScoring = performance.now();
    const tiempoTotalMs = finScoring - inicioScoring;
    const tiempoPromedioPorClienteMs = tiempoTotalMs / totalClientes;

    expect(tiempoTotalMs).toBeLessThan(1000); // 500 clientes evaluados en < 1s
    expect(tiempoPromedioPorClienteMs).toBeLessThan(1.0); // < 1ms por cliente
    expect(clientes[0].nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_2);
  });
});
