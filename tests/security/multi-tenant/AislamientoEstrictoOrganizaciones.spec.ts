import { ClientesQueryService } from '../../../src/bounded-contexts/clientes/application/queries/ClientesQueryService';

describe('Seguridad & Multi-Tenant — Aislamiento Criptográfico y Prevención de Fugas de Datos Entre Organizaciones', () => {
  let service: ClientesQueryService;
  let mockPrisma: any;
  let mockEncryptionService: any;

  const tenantVictima = 'tenant-empresa-a-cevallos';
  const tenantAtacante = 'tenant-empresa-b-competencia';

  beforeEach(() => {
    mockEncryptionService = {
      encrypt: jest.fn((val) => `enc-${val}`),
      decrypt: jest.fn((val) => (val ? val.replace('enc-', '') : '')),
    };

    mockPrisma = {
      tenant: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === tenantVictima) {
            return Promise.resolve({
              id: tenantVictima,
              name: 'Calzados Cevallos A',
              businessConfig: { ruc: 'enc-1801111111001' },
            });
          }
          if (where.id === tenantAtacante) {
            return Promise.resolve({
              id: tenantAtacante,
              name: 'Comercial Calzado B',
              businessConfig: { ruc: 'enc-1802222222001' },
            });
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: tenantVictima, businessConfig: { ruc: 'enc-1801111111001' }, users: [] },
          { id: tenantAtacante, businessConfig: { ruc: 'enc-1802222222001' }, users: [] },
        ]),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      client: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          // Filtrado estricto por tenantId
          if (where?.tenantId?.in) {
            if (where.tenantId.in.includes(tenantVictima)) {
              return Promise.resolve([
                {
                  id: 'cli-victima-01',
                  nombre: 'Cliente Privado Empresa A',
                  cedula: 'enc-1710034065',
                  tenantId: tenantVictima,
                },
              ]);
            }
            if (where.tenantId.in.includes(tenantAtacante)) {
              return Promise.resolve([]);
            }
          }
          return Promise.resolve([]);
        }),
      },
    };

    service = new ClientesQueryService(mockPrisma as any, mockEncryptionService as any);
  });

  it('debe impedir que un usuario del Tenant B acceda a la lista de clientes confidenciales del Tenant A', async () => {
    const clientesAtacante = await service.buscarClientes({}, tenantAtacante);

    expect(clientesAtacante.length).toBe(0);
    expect(clientesAtacante.some((c) => c.id === 'cli-victima-01')).toBe(false);
  });
});
