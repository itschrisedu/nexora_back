import { ConfiguracionService } from '../../../src/configuracion/configuracion.service';
import { ConflictException } from '@nestjs/common';

describe('ConfiguracionService — Pruebas Unitarias', () => {
  let service: ConfiguracionService;
  let mockPrisma: any;
  let mockEncryption: any;
  let mockCloudinary: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
      tenant: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          name: 'Calzado Cevallos',
          businessConfig: { ruc: 'enc_1801234567001' },
        }),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'child-tenant-1', name: 'Sucursal Norte' }),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'user-admin-1', rol: 'ROL_ADMIN' }),
        create: jest.fn().mockResolvedValue({ id: 'user-suc-admin' }),
      },
      sucursal: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'suc-2',
          name: 'Sucursal Norte',
          tenantId: 'tenant-1',
          active: true,
        }),
        update: jest.fn(),
      },
      businessConfig: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'bc-1' }),
        update: jest.fn(),
      },
      sucursalSerie: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      sucursalCategoria: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      serie: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      categoria: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditoriaLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    mockEncryption = {
      encrypt: jest.fn((val: string) => `enc_${val}`),
      decrypt: jest.fn((val: string) => val.replace('enc_', '')),
    };

    mockCloudinary = {
      deleteImage: jest.fn().mockResolvedValue(true),
    };

    service = new ConfiguracionService(mockPrisma, mockEncryption, mockCloudinary);
  });

  describe('Validación de Sucursales Duplicadas', () => {
    it('debe rechazar la creación de una sucursal con el mismo nombre (case-insensitive)', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({
        id: 'existing-tenant',
        name: 'Sucursal Centro',
      });

      await expect(
        service.createSucursal('tenant-1', {
          name: '  sucursal centro  ',
          direccion: 'Av. Cevallos 100',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe permitir crear una sucursal con nombre único', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue(null);

      const result = await service.createSucursal('tenant-1', {
        name: 'Sucursal Norte',
        direccion: 'Calle 10',
      });

      expect(result).toBeDefined();
    });
  });

  describe('Validación de Negocio / Tenant', () => {
    it('debe rechazar upsertBusinessConfig si otra empresa ya usa ese nombre', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({
        id: 'other-tenant',
        name: 'Calzados El Sol',
      });

      await expect(
        service.upsertBusinessConfig({
          nombre: 'calzados el sol',
          ruc: '1801234567001',
          direccion: 'Cevallos',
        } as any, 'tenant-1'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
