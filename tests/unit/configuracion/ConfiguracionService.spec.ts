import { ConfiguracionService } from '../../../src/configuracion/configuracion.service';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

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
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'user-suc-admin' }),
        update: jest.fn().mockResolvedValue({
          id: 'target-user',
          nombre: 'Juan Perez',
          email: 'juan@test.com',
          rol: 'ROL_VENDEDOR',
          esAdminGeneral: false,
          activo: true,
          permiteCambiarPrecio: false,
          tenantId: 'tenant-1',
        }),
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
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'bc-1' }),
        update: jest.fn(),
        updateMany: jest.fn(),
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

  // ══════════════════════════════
  // SEGURIDAD DE JERARQUÍA DE ROLES — updatePersonal
  // ══════════════════════════════

  describe('Jerarquía de roles — updatePersonal', () => {
    const setupGetOrganizationTenantIds = () => {
      // Mock tenant.findMany to return the org tenants for getOrganizationTenantIds
      mockPrisma.tenant.findMany.mockResolvedValue([
        {
          id: 'tenant-1',
          name: 'Calzado Cevallos',
          businessConfig: { ruc: 'enc_1801234567001' },
          users: [{ id: 'user-admin-1', parentId: null, rol: 'ROL_ADMIN' }],
        },
      ]);
    };

    it('debe rechazar cuando un Admin de Sucursal intenta editar a un Admin General', async () => {
      setupGetOrganizationTenantIds();

      // El target user es Admin General
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'admin-general-1',
        nombre: 'Carlos Admin General',
        email: 'carlos@test.com',
        rol: 'ROL_ADMIN',
        esAdminGeneral: true,
        activo: true,
        permiteCambiarPrecio: true,
        tenantId: 'tenant-1',
      });

      const adminSucursal = {
        id: 'admin-suc-1',
        rol: 'ROL_ADMIN' as any,
        esAdminGeneral: false,
      };

      await expect(
        service.updatePersonal(
          'tenant-1',
          'admin-general-1',
          { nombre: 'Nombre Cambiado' },
          adminSucursal,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe rechazar cuando un Admin de Sucursal intenta editar a un Super Admin', async () => {
      setupGetOrganizationTenantIds();

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'super-admin-1',
        nombre: 'Super Admin',
        email: 'super@test.com',
        rol: 'ROL_SUPER_ADMIN',
        esAdminGeneral: false,
        activo: true,
        permiteCambiarPrecio: true,
        tenantId: 'tenant-1',
      });

      const adminSucursal = {
        id: 'admin-suc-2',
        rol: 'ROL_ADMIN' as any,
        esAdminGeneral: false,
      };

      await expect(
        service.updatePersonal(
          'tenant-1',
          'super-admin-1',
          { activo: false },
          adminSucursal,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe permitir que un Admin General edite a un Admin de Sucursal', async () => {
      setupGetOrganizationTenantIds();

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'admin-suc-target',
        nombre: 'Pedro Vendedor',
        email: 'pedro@test.com',
        rol: 'ROL_ADMIN',
        esAdminGeneral: false,
        activo: true,
        permiteCambiarPrecio: false,
        tenantId: 'tenant-1',
      });

      const adminGeneral = {
        id: 'admin-general-1',
        rol: 'ROL_ADMIN' as any,
        esAdminGeneral: true,
      };

      const result = await service.updatePersonal(
        'tenant-1',
        'admin-suc-target',
        { nombre: 'Pedro Actualizado' },
        adminGeneral,
      );

      expect(result).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('debe permitir que un Admin de Sucursal edite a un Vendedor (mismo nivel o inferior)', async () => {
      setupGetOrganizationTenantIds();

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'vendedor-1',
        nombre: 'Maria Vendedora',
        email: 'maria@test.com',
        rol: 'ROL_VENDEDOR',
        esAdminGeneral: false,
        activo: true,
        permiteCambiarPrecio: false,
        tenantId: 'tenant-1',
      });

      const adminSucursal = {
        id: 'admin-suc-3',
        rol: 'ROL_ADMIN' as any,
        esAdminGeneral: false,
      };

      const result = await service.updatePersonal(
        'tenant-1',
        'vendedor-1',
        { permiteCambiarPrecio: true },
        adminSucursal,
      );

      expect(result).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('debe lanzar NotFoundException si el colaborador no pertenece a la empresa', async () => {
      setupGetOrganizationTenantIds();

      mockPrisma.user.findFirst.mockResolvedValue(null);

      const adminGeneral = {
        id: 'admin-general-1',
        rol: 'ROL_ADMIN' as any,
        esAdminGeneral: true,
      };

      await expect(
        service.updatePersonal(
          'tenant-1',
          'user-inexistente',
          { nombre: 'Test' },
          adminGeneral,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe permitir que un Super Admin edite a cualquier usuario incluyendo Admin General', async () => {
      setupGetOrganizationTenantIds();

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'admin-general-1',
        nombre: 'Carlos Admin General',
        email: 'carlos@test.com',
        rol: 'ROL_ADMIN',
        esAdminGeneral: true,
        activo: true,
        permiteCambiarPrecio: true,
        tenantId: 'tenant-1',
      });

      const superAdmin = {
        id: 'super-admin-1',
        rol: 'ROL_SUPER_ADMIN' as any,
        esAdminGeneral: false,
      };

      const result = await service.updatePersonal(
        'tenant-1',
        'admin-general-1',
        { nombre: 'Carlos Editado por Super' },
        superAdmin,
      );

      expect(result).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });
  });
});
