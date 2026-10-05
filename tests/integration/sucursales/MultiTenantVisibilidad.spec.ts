import { ClientesQueryService } from '../../../src/bounded-contexts/clientes/application/queries/ClientesQueryService';

describe('Integración — Multi-Tenant y Visibilidad Organizacional (Matriz / Sucursales)', () => {
  let service: ClientesQueryService;
  let mockPrisma: any;
  let mockEncryptionService: any;

  const tenantMatriz = 'tenant-org-matriz';
  const tenantSucursal1 = 'tenant-org-sucursal-1';
  const tenantSucursal2 = 'tenant-org-sucursal-2';
  const tenantOtraOrg = 'tenant-otra-empresa';

  const mockTenantsDb: Record<string, any> = {
    [tenantMatriz]: {
      id: tenantMatriz,
      name: 'Calzados Cevallos - Matriz',
      active: true,
      businessConfig: { ruc: 'enc-1801234567001' },
      users: [{ id: 'usr-admin-1', parentId: null }],
    },
    [tenantSucursal1]: {
      id: tenantSucursal1,
      name: 'Calzados Cevallos - Sucursal Centro',
      active: true,
      businessConfig: { ruc: 'enc-1801234567001' },
      users: [{ id: 'usr-sub-1', parentId: 'usr-admin-1' }],
    },
    [tenantSucursal2]: {
      id: tenantSucursal2,
      name: 'Calzados Cevallos - Sucursal Norte',
      active: true,
      businessConfig: { ruc: 'enc-1801234567001' },
      users: [{ id: 'usr-sub-2', parentId: 'usr-admin-1' }],
    },
    [tenantOtraOrg]: {
      id: tenantOtraOrg,
      name: 'Calzados Tungurahua - Local Independiente',
      active: true,
      businessConfig: { ruc: 'enc-1799999999001' },
      users: [{ id: 'usr-otra-1', parentId: null }],
    },
  };

  const mockClientsDb = [
    {
      id: 'cli-01',
      nombre: 'María',
      apellido: 'López',
      cedula: 'enc-1804445555',
      ruc: null,
      telefono: '0991234567',
      email: 'maria.lopez@gmail.com',
      direccion: 'Cevallos Centro',
      notas: null,
      nivelCredito: 'NIVEL_2',
      totalCompras: 12,
      comprasSinAtraso: 12,
      atrasoConsecutivo: 0,
      limiteCredito: 500,
      creditoUtilizado: 100,
      saldoAFavor: 0,
      activo: true,
      tenantId: tenantMatriz,
      tenant: { id: tenantMatriz, name: 'Calzados Cevallos - Matriz' },
      createdAt: new Date('2026-01-10'),
      updatedAt: new Date('2026-01-10'),
    },
    {
      id: 'cli-02',
      nombre: 'Carlos',
      apellido: 'Paredes',
      cedula: 'enc-1807778888',
      ruc: null,
      telefono: '0987654321',
      email: 'carlos.paredes@gmail.com',
      direccion: 'Ambato',
      notas: null,
      nivelCredito: 'NIVEL_1',
      totalCompras: 2,
      comprasSinAtraso: 2,
      atrasoConsecutivo: 0,
      limiteCredito: 0,
      creditoUtilizado: 0,
      saldoAFavor: 0,
      activo: true,
      tenantId: tenantOtraOrg,
      tenant: { id: tenantOtraOrg, name: 'Calzados Tungurahua - Local Independiente' },
      createdAt: new Date('2026-02-15'),
      updatedAt: new Date('2026-02-15'),
    },
  ];

  beforeEach(() => {
    mockEncryptionService = {
      decrypt: jest.fn((val: string) => {
        if (!val) return val;
        return val.replace('enc-', '');
      }),
      encrypt: jest.fn((val: string) => `enc-${val}`),
    };

    mockPrisma = {
      tenant: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(mockTenantsDb[where.id] || null);
        }),
        findMany: jest.fn().mockImplementation(() => {
          return Promise.resolve(Object.values(mockTenantsDb));
        }),
      },
      user: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          const tenant = mockTenantsDb[where.tenantId];
          if (!tenant) return Promise.resolve(null);
          if (where.rol) {
            return Promise.resolve(tenant.users[0] || null);
          }
          return Promise.resolve(tenant.users[0] || null);
        }),
      },
      client: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          let list = [...mockClientsDb];
          if (where?.tenantId) {
            if (where.tenantId.in) {
              list = list.filter((c) => where.tenantId.in.includes(c.tenantId));
            } else {
              list = list.filter((c) => c.tenantId === where.tenantId);
            }
          }
          return Promise.resolve(list);
        }),
      },
    };

    service = new ClientesQueryService(mockPrisma as any, mockEncryptionService as any);
  });

  it('debe compartir la visibilidad de clientes entre la Matriz y sus Sucursales de la misma organización (mismo RUC matriz)', async () => {
    // Consulta desde la Matriz
    const clientesMatriz = await service.buscarClientes({}, tenantMatriz);
    // Consulta desde la Sucursal 1
    const clientesSucursal1 = await service.buscarClientes({}, tenantSucursal1);
    // Consulta desde la Sucursal 2
    const clientesSucursal2 = await service.buscarClientes({}, tenantSucursal2);

    expect(clientesMatriz.length).toBe(1);
    expect(clientesSucursal1.length).toBe(1);
    expect(clientesSucursal2.length).toBe(1);

    // Todas las sucursales vinculadas pueden ver al cliente registrado en Matriz
    expect(clientesMatriz[0].id).toBe('cli-01');
    expect(clientesSucursal1[0].id).toBe('cli-01');
    expect(clientesSucursal2[0].id).toBe('cli-01');
    expect(clientesSucursal1[0].nombre).toBe('María');
    expect(clientesSucursal1[0].cedula).toBe('1804445555');
  });

  it('debe mantener aislamiento estricto impidiendo ver clientes de organizaciones ajenas', async () => {
    // Consulta desde otra organización independiente
    const clientesOtraOrg = await service.buscarClientes({}, tenantOtraOrg);

    expect(clientesOtraOrg.length).toBe(1);
    expect(clientesOtraOrg[0].id).toBe('cli-02');
    expect(clientesOtraOrg[0].nombre).toBe('Carlos');

    // La otra organización NO debe poder ver a María (cli-01 de la organización Calzados Cevallos)
    const tieneClienteAjeno = clientesOtraOrg.some((c) => c.id === 'cli-01');
    expect(tieneClienteAjeno).toBe(false);
  });
});
