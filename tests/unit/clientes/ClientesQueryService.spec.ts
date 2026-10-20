import { ClientesQueryService } from '../../../src/bounded-contexts/clientes/application/queries/ClientesQueryService';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

describe('ClientesQueryService — Búsqueda, Scoring y CRM', () => {
  let queryService: ClientesQueryService;
  let mockPrisma: any;
  let mockEncryptionService: any;

  const tenantId = 'tenant-test-01';

  const clientesMock = [
    {
      id: 'cli-01',
      nombre: 'María',
      apellido: 'González',
      telefono: '0991234567',
      email: 'maria@test.com',
      cedula: 'enc-1710034065',
      ruc: null,
      direccion: 'Av. Cevallos y Pérez',
      notas: null,
      nivelCredito: PrismaNivelCredito.NIVEL_2,
      totalCompras: 15,
      comprasSinAtraso: 15,
      atrasoConsecutivo: 0,
      limiteCredito: 700,
      creditoUtilizado: 200,
      saldoAFavor: 0,
      activo: true,
      tenantId,
      createdAt: new Date('2025-01-15'),
      updatedAt: new Date('2026-09-01'),
      tenant: { id: tenantId, name: 'Local Cevallos' },
    },
    {
      id: 'cli-02',
      nombre: 'José',
      apellido: 'Hernández',
      telefono: '0987654321',
      email: 'jose@test.com',
      cedula: 'enc-1803730276',
      ruc: 'enc-1803730276001',
      direccion: 'Calle Sucre 456',
      notas: null,
      nivelCredito: PrismaNivelCredito.NIVEL_1,
      totalCompras: 10,
      comprasSinAtraso: 10,
      atrasoConsecutivo: 0,
      limiteCredito: 300,
      creditoUtilizado: 0,
      saldoAFavor: 0,
      activo: true,
      tenantId,
      createdAt: new Date('2025-03-10'),
      updatedAt: new Date('2026-08-15'),
      tenant: { id: tenantId, name: 'Local Cevallos' },
    },
    {
      id: 'cli-03',
      nombre: 'Andrés',
      apellido: 'López',
      telefono: '0976543210',
      email: 'andres@test.com',
      cedula: null,
      ruc: null,
      direccion: 'Barrio El Triunfo',
      notas: null,
      nivelCredito: PrismaNivelCredito.SIN_CREDITO,
      totalCompras: 2,
      comprasSinAtraso: 2,
      atrasoConsecutivo: 0,
      limiteCredito: 0,
      creditoUtilizado: 0,
      saldoAFavor: 0,
      activo: true,
      tenantId,
      createdAt: new Date('2026-09-01'),
      updatedAt: new Date('2026-09-15'),
      tenant: { id: tenantId, name: 'Local Cevallos' },
    },
  ];

  beforeEach(() => {
    mockEncryptionService = {
      encrypt: jest.fn((str) => `enc-${str}`),
      decrypt: jest.fn((str) => str.replace('enc-', '')),
    };

    mockPrisma = {
      client: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          const found = clientesMock.find((c) => c.id === where.id);
          return Promise.resolve(found || null);
        }),
        findMany: jest.fn().mockResolvedValue(clientesMock),
        update: jest.fn().mockResolvedValue({}),
      },
      cobro: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: tenantId,
          businessConfig: { ruc: 'enc-1803730276001' },
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: tenantId, businessConfig: { ruc: 'enc-1803730276001' }, users: [] },
        ]),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      creditLevelConfig: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          const map: any = {
            [PrismaNivelCredito.NIVEL_1]: { nivel: PrismaNivelCredito.NIVEL_1, plazoDias: 15, limiteDolares: 300 },
            [PrismaNivelCredito.NIVEL_2]: { nivel: PrismaNivelCredito.NIVEL_2, plazoDias: 30, limiteDolares: 700 },
          };
          return Promise.resolve(map[where.nivel] || null);
        }),
      },
      creditScoreHistory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      saleNote: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    queryService = new ClientesQueryService(mockPrisma as any, mockEncryptionService as any);
  });

  // ══════════════════════════════
  // BÚSQUEDA CON Y SIN TILDES
  // ══════════════════════════════

  describe('buscarClientes — normalización de tildes y acentos', () => {
    it('debe encontrar clientes por nombre CON tilde exacta', async () => {
      const resultados = await queryService.buscarClientes({ q: 'María' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].nombre).toBe('María');
    });

    it('debe encontrar clientes por nombre SIN tilde (normalización NFD)', async () => {
      const resultados = await queryService.buscarClientes({ q: 'Maria' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].nombre).toBe('María');
    });

    it('debe encontrar "González" buscando "Gonzalez" sin tilde', async () => {
      const resultados = await queryService.buscarClientes({ q: 'Gonzalez' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].apellido).toBe('González');
    });

    it('debe encontrar "Hernández" buscando "Hernandez" sin tilde', async () => {
      const resultados = await queryService.buscarClientes({ q: 'Hernandez' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].apellido).toBe('Hernández');
    });

    it('debe encontrar "Andrés" buscando "Andres" sin tilde', async () => {
      const resultados = await queryService.buscarClientes({ q: 'Andres' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].nombre).toBe('Andrés');
    });

    it('debe encontrar "López" buscando "Lopez" sin tilde', async () => {
      const resultados = await queryService.buscarClientes({ q: 'Lopez' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].apellido).toBe('López');
    });

    it('debe ser case-insensitive en la búsqueda', async () => {
      const resultados = await queryService.buscarClientes({ q: 'MARIA' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].nombre).toBe('María');
    });

    it('debe retornar todos los clientes cuando no hay término de búsqueda', async () => {
      const resultados = await queryService.buscarClientes({}, tenantId);
      expect(resultados.length).toBe(3);
    });

    it('debe buscar por número de teléfono', async () => {
      const resultados = await queryService.buscarClientes({ q: '0987654321' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].nombre).toBe('José');
    });

    it('debe buscar por email', async () => {
      const resultados = await queryService.buscarClientes({ q: 'andres@test.com' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].nombre).toBe('Andrés');
    });

    it('debe buscar por dirección sin tildes (ej: "Perez" para "Pérez")', async () => {
      const resultados = await queryService.buscarClientes({ q: 'Perez' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].direccion).toContain('Pérez');
    });

    it('debe retornar vacío si el término no coincide con ningún cliente', async () => {
      const resultados = await queryService.buscarClientes({ q: 'ZZZNoExiste' }, tenantId);
      expect(resultados.length).toBe(0);
    });

    it('debe buscar por cédula descifrada', async () => {
      const resultados = await queryService.buscarClientes({ q: '1710034065' }, tenantId);
      expect(resultados.length).toBe(1);
      expect(resultados[0].nombre).toBe('María');
    });
  });

  // ══════════════════════════════
  // OBTENER CLIENTE Y DESCIFRADO
  // ══════════════════════════════

  describe('obtenerCliente — descifrado de datos personales', () => {
    it('debe descifrar cédula y RUC al obtener un cliente', async () => {
      const cliente = await queryService.obtenerCliente('cli-02');
      expect(cliente.cedula).toBe('1803730276');
      expect(cliente.ruc).toBe('1803730276001');
      expect(mockEncryptionService.decrypt).toHaveBeenCalled();
    });

    it('debe lanzar NotFoundException si el cliente no existe', async () => {
      await expect(queryService.obtenerCliente('cli-inexistente')).rejects.toThrow(
        'Cliente con ID "cli-inexistente" no encontrado',
      );
    });

    it('debe devolver null en cédula si el campo está vacío', async () => {
      const cliente = await queryService.obtenerCliente('cli-03');
      expect(cliente.cedula).toBeNull();
    });
  });

  // ══════════════════════════════
  // VALIDAR CAPACIDAD CREDITICIA
  // ══════════════════════════════

  describe('validarCapacidadCrediticia', () => {
    it('debe aprobar si el monto solicitado está dentro del cupo disponible', async () => {
      mockPrisma.cobro.findMany.mockResolvedValue([{ saldoPendiente: 200 }]);

      const result = await queryService.validarCapacidadCrediticia('cli-01', 400);
      expect(result.aprobado).toBe(true);
      expect(result.limiteTotal).toBe(700);
      expect(result.creditoUtilizado).toBe(200);
      expect(result.limiteDisponible).toBe(500);
    });

    it('debe rechazar si el monto solicitado supera el cupo disponible', async () => {
      mockPrisma.cobro.findMany.mockResolvedValue([{ saldoPendiente: 500 }]);

      const result = await queryService.validarCapacidadCrediticia('cli-01', 300);
      expect(result.aprobado).toBe(false);
      expect(result.razon).toContain('supera su cupo de crédito máximo');
    });

    it('debe rechazar si el cliente no tiene crédito asignado (SIN_CREDITO)', async () => {
      const result = await queryService.validarCapacidadCrediticia('cli-03', 50);
      expect(result.aprobado).toBe(false);
      expect(result.razon).toContain('no tiene cupo de crédito asignado');
    });

    it('debe lanzar NotFoundException si el cliente no existe', async () => {
      await expect(
        queryService.validarCapacidadCrediticia('cli-inexistente', 100),
      ).rejects.toThrow('no encontrado');
    });

    it('debe sincronizar creditoUtilizado si existe desbalance con cobros reales', async () => {
      mockPrisma.cobro.findMany.mockResolvedValue([{ saldoPendiente: 350 }]);

      await queryService.validarCapacidadCrediticia('cli-01', 100);

      expect(mockPrisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cli-01' },
          data: { creditoUtilizado: 350 },
        }),
      );
    });
  });

  // ══════════════════════════════
  // CRM: CLIENTES INACTIVOS
  // ══════════════════════════════

  describe('obtenerClientesInactivos', () => {
    it('debe identificar clientes que nunca compraron como inactivos', async () => {
      // Forzar que findMany devuelva un solo cliente registrado hace 45 días
      const hace45Dias = new Date();
      hace45Dias.setDate(hace45Dias.getDate() - 45);

      mockPrisma.client.findMany.mockResolvedValue([
        {
          ...clientesMock[2],
          createdAt: hace45Dias,
        },
      ]);

      const inactivos = await queryService.obtenerClientesInactivos(tenantId, 30);
      expect(inactivos.length).toBe(1);
      expect(inactivos[0].nuncaCompro).toBe(true);
      expect(inactivos[0].diasSinComprar).toBeGreaterThanOrEqual(44);
      expect(inactivos[0].rangoInactividad).toBe('30_A_60_DIAS');
    });

    it('debe clasificar correctamente el rango de inactividad 60-90 días', async () => {
      const hace75Dias = new Date();
      hace75Dias.setDate(hace75Dias.getDate() - 75);

      mockPrisma.client.findMany.mockResolvedValue([
        { ...clientesMock[0], createdAt: hace75Dias },
      ]);
      mockPrisma.order.findFirst.mockResolvedValue({
        id: 'ord-1',
        createdAt: hace75Dias,
        montoTotal: 200,
        estado: 'ENTREGADO',
      });

      const inactivos = await queryService.obtenerClientesInactivos(tenantId, 30);
      expect(inactivos.length).toBe(1);
      expect(inactivos[0].rangoInactividad).toBe('60_A_90_DIAS');
    });

    it('debe retornar lista vacía si todos los clientes compraron recientemente', async () => {
      const ayer = new Date();
      ayer.setDate(ayer.getDate() - 1);

      mockPrisma.client.findMany.mockResolvedValue([clientesMock[0]]);
      mockPrisma.order.findFirst.mockResolvedValue({
        id: 'ord-1',
        createdAt: ayer,
        montoTotal: 150,
        estado: 'ENTREGADO',
      });

      const inactivos = await queryService.obtenerClientesInactivos(tenantId, 30);
      expect(inactivos.length).toBe(0);
    });
  });
});
