import { Cliente } from '../../../src/bounded-contexts/clientes/domain/Cliente';
import { Money } from '../../../src/shared/domain/Money';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';
import { ClientesQueryService } from '../../../src/bounded-contexts/clientes/application/queries/ClientesQueryService';

describe('E2E / Sistema — Flujo de Gestión de Clientes, Cifrado de Identidad y Scoring Crediticio', () => {
  let queryService: ClientesQueryService;
  let mockPrisma: any;
  let mockEncryptionService: any;

  const tenantId = 'tenant-cevallos-01';
  const configsCredito = [
    { nivel: PrismaNivelCredito.NIVEL_4, comprasRequeridas: 10, limiteDolares: 2000 },
    { nivel: PrismaNivelCredito.NIVEL_3, comprasRequeridas: 6, limiteDolares: 1000 },
    { nivel: PrismaNivelCredito.NIVEL_2, comprasRequeridas: 3, limiteDolares: 500 },
    { nivel: PrismaNivelCredito.SIN_CREDITO, comprasRequeridas: 0, limiteDolares: 0 },
  ];

  beforeEach(() => {
    mockEncryptionService = {
      encrypt: jest.fn((str) => `enc-${str}`),
      decrypt: jest.fn((str) => str.replace('enc-', '')),
    };

    mockPrisma = {
      client: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'cli-test-01') {
            return Promise.resolve({
              id: 'cli-test-01',
              nombre: 'Carlos',
              apellido: 'García',
              cedula: 'enc-1710034065',
              ruc: null,
              telefono: '0991234567',
              email: 'carlos@gmail.com',
              nivelCredito: PrismaNivelCredito.NIVEL_2,
              limiteCredito: 500,
              creditoUtilizado: 150,
              saldoAFavor: 0,
              activo: true,
              tenantId,
              tenant: { id: tenantId, name: 'Local Cevallos' },
            });
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ id: tenantId, businessConfig: { ruc: 'enc-1803730276001' } }),
        findMany: jest.fn().mockResolvedValue([{ id: tenantId, businessConfig: { ruc: 'enc-1803730276001' }, users: [] }]),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      creditLevelConfig: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.nivel === PrismaNivelCredito.NIVEL_2) {
            return Promise.resolve({ nivel: PrismaNivelCredito.NIVEL_2, plazoDias: 30, limiteDolares: 500 });
          }
          return Promise.resolve(null);
        }),
      },
    };

    queryService = new ClientesQueryService(mockPrisma as any, mockEncryptionService as any);
  });

  it('debe simular el ciclo E2E de ascenso de nivel de crédito de un cliente con compras cumplidas', () => {
    // 1. Crear cliente nuevo en Nivel 1 (Sin Crédito)
    const cliente = Cliente.crear(
      'cli-scoring-01',
      'Juan',
      'Pérez',
      '0998765432',
      'juan@gmail.com',
      null,
      '1710034065',
      'Cevallos Centro',
      null,
    );

    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.SIN_CREDITO);
    expect(cliente.limiteCredito.amount).toBe(0);

    // 2. Realizar 3 compras de contado exitosas
    cliente.registrarCompraCompletada(Money.create(150), false, configsCredito);
    cliente.registrarCompraCompletada(Money.create(200), false, configsCredito);
    cliente.registrarCompraCompletada(Money.create(180), false, configsCredito);

    // 3. El cliente asciende automáticamente a NIVEL_2 con cupo de $500
    expect(cliente.totalCompras).toBe(3);
    expect(cliente.comprasSinAtraso).toBe(3);
    expect(cliente.nivelCredito.value).toBe(PrismaNivelCredito.NIVEL_2);
    expect(cliente.limiteCredito.amount).toBe(500);

    // 4. Comprometer crédito en una nueva compra a plazo
    cliente.comprometerCredito(Money.create(200));
    expect(cliente.creditoUtilizado.amount).toBe(200);

    // 5. Liberar crédito tras el pago de la cuota
    cliente.liberarCredito(Money.create(200));
    expect(cliente.creditoUtilizado.amount).toBe(0);
  });

  it('debe consultar y validar la capacidad crediticia descifrando datos personales al vuelo', async () => {
    const validacion = await queryService.validarCapacidadCrediticia('cli-test-01', 300);

    expect(validacion.aprobado).toBe(true);
    expect(validacion.limiteTotal).toBe(500);
    expect(validacion.creditoUtilizado).toBe(150);
    expect(validacion.limiteDisponible).toBe(350);
    expect(validacion.plazoDias).toBe(30);

    // Si solicita más del cupo disponible ($350), debe ser rechazado
    const validacionExcedida = await queryService.validarCapacidadCrediticia('cli-test-01', 400);
    expect(validacionExcedida.aprobado).toBe(false);
    expect(validacionExcedida.razon).toContain('supera límite disponible');
  });
});
