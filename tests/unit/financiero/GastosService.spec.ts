import { GastosService } from '../../../src/bounded-contexts/financiero/application/GastosService';
import { NotFoundException } from '@nestjs/common';

describe('GastosService — Pruebas Unitarias', () => {
  let service: GastosService;
  let mockPrisma: any;

  const tenantId = 'tenant-test-01';
  const userId = 'user-admin-01';

  const gastoBase = {
    id: 'gasto-01',
    tenantId,
    userId,
    categoria: 'SERVICIOS_BASICOS',
    concepto: 'Pago de luz electrica del local',
    monto: 45.50,
    metodoPago: 'EFECTIVO',
    fecha: new Date('2026-10-01'),
    numeroComprobante: 'COMP-001',
    proveedorServicio: 'Empresa Electrica',
    comprobanteUrl: null,
    observaciones: null,
    orderId: null,
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    user: { id: userId, nombre: 'Admin Test', email: 'admin@test.com' },
    order: null,
    tenant: { id: tenantId, name: 'Calzado Cevallos', businessConfig: { nombre: 'Calzado Cevallos Centro' } },
  };

  beforeEach(() => {
    mockPrisma = {
      gasto: {
        create: jest.fn().mockResolvedValue({ ...gastoBase }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    service = new GastosService(mockPrisma);
  });

  // ──────────────────────────────────────────────────────────────
  // CREAR GASTO
  // ──────────────────────────────────────────────────────────────

  describe('crearGasto', () => {
    it('debe crear un gasto con datos completos y retornar formateado', async () => {
      const dto = {
        categoria: 'SERVICIOS_BASICOS' as any,
        concepto: 'Pago de luz electrica del local',
        monto: 45.50,
        metodoPago: 'EFECTIVO' as any,
        fecha: '2026-10-01',
        numeroComprobante: 'COMP-001',
        proveedorServicio: 'Empresa Electrica',
      };

      const result = await service.crearGasto(tenantId, userId, dto as any);

      expect(mockPrisma.gasto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            userId,
            categoria: 'SERVICIOS_BASICOS',
            concepto: 'Pago de luz electrica del local',
            monto: 45.50,
          }),
        }),
      );
      expect(result.id).toBe('gasto-01');
      expect(result.monto).toBe(45.50);
      expect(result.sucursalNombre).toBe('Calzado Cevallos Centro');
      expect(result.usuarioNombre).toBe('Admin Test');
    });

    it('debe usar sucursalId como tenantId si se proporciona', async () => {
      const dto = {
        categoria: 'ARRIENDO' as any,
        concepto: 'Arriendo local norte',
        monto: 300,
        sucursalId: 'sucursal-norte-01',
      };

      await service.crearGasto(tenantId, userId, dto as any);

      expect(mockPrisma.gasto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'sucursal-norte-01',
          }),
        }),
      );
    });

    it('debe usar EFECTIVO como metodo de pago por defecto', async () => {
      const dto = {
        categoria: 'INSUMOS' as any,
        concepto: 'Compra de fundas',
        monto: 12,
      };

      await service.crearGasto(tenantId, userId, dto as any);

      expect(mockPrisma.gasto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metodoPago: 'EFECTIVO',
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // LISTAR GASTOS CON FILTROS
  // ──────────────────────────────────────────────────────────────

  describe('listarGastos', () => {
    it('debe listar gastos filtrando por tenantId', async () => {
      mockPrisma.gasto.findMany.mockResolvedValue([gastoBase]);

      const result = await service.listarGastos(tenantId);

      expect(mockPrisma.gasto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId }),
          orderBy: { fecha: 'desc' },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].concepto).toBe('Pago de luz electrica del local');
    });

    it('debe filtrar por categoria cuando se especifica', async () => {
      mockPrisma.gasto.findMany.mockResolvedValue([]);

      await service.listarGastos(tenantId, { categoria: 'ARRIENDO' } as any);

      expect(mockPrisma.gasto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ categoria: 'ARRIENDO' }),
        }),
      );
    });

    it('debe filtrar por rango de fechas', async () => {
      mockPrisma.gasto.findMany.mockResolvedValue([]);

      await service.listarGastos(tenantId, {
        fechaDesde: '2026-10-01',
        fechaHasta: '2026-10-31',
      } as any);

      const callArgs = mockPrisma.gasto.findMany.mock.calls[0][0];
      expect(callArgs.where.fecha.gte).toEqual(new Date('2026-10-01'));
      expect(callArgs.where.fecha.lte).toBeDefined();
    });

    it('debe filtrar por mes y anio cuando no hay rango de fechas', async () => {
      mockPrisma.gasto.findMany.mockResolvedValue([]);

      await service.listarGastos(tenantId, { mes: 9, anio: 2026 } as any);

      const callArgs = mockPrisma.gasto.findMany.mock.calls[0][0];
      expect(callArgs.where.fecha).toBeDefined();
      expect(callArgs.where.fecha.gte).toBeDefined();
      expect(callArgs.where.fecha.lte).toBeDefined();
    });

    it('debe filtrar por sucursalId en lugar de tenantId', async () => {
      mockPrisma.gasto.findMany.mockResolvedValue([]);

      await service.listarGastos(tenantId, { sucursalId: 'suc-norte' } as any);

      const callArgs = mockPrisma.gasto.findMany.mock.calls[0][0];
      expect(callArgs.where.tenantId).toBe('suc-norte');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // ESTADISTICAS DE GASTOS
  // ──────────────────────────────────────────────────────────────

  describe('obtenerEstadisticasGastos', () => {
    it('debe calcular total del mes, desglose por categoria y variacion porcentual', async () => {
      mockPrisma.gasto.findMany
        .mockResolvedValueOnce([
          { monto: 45, categoria: 'SERVICIOS_BASICOS', metodoPago: 'EFECTIVO' },
          { monto: 300, categoria: 'ARRIENDO', metodoPago: 'TRANSFERENCIA' },
          { monto: 20, categoria: 'SERVICIOS_BASICOS', metodoPago: 'EFECTIVO' },
        ])
        .mockResolvedValueOnce([
          { monto: 250, categoria: 'ARRIENDO', metodoPago: 'TRANSFERENCIA' },
        ]);

      const result = await service.obtenerEstadisticasGastos(tenantId, 9, 2026);

      expect(result.totalMes).toBe(365);
      expect(result.totalMesAnterior).toBe(250);
      expect(result.cantidadGastos).toBe(3);
      expect(result.variacionPorcentual).toBe(46); // ((365-250)/250)*100 = 46%
      expect(result.porCategoria.length).toBeGreaterThanOrEqual(2);
      expect(result.porMetodo.length).toBe(2);
    });

    it('debe retornar variacion 0% si no hubo gastos el mes anterior', async () => {
      mockPrisma.gasto.findMany
        .mockResolvedValueOnce([{ monto: 100, categoria: 'INSUMOS', metodoPago: 'EFECTIVO' }])
        .mockResolvedValueOnce([]);

      const result = await service.obtenerEstadisticasGastos(tenantId, 9, 2026);

      expect(result.variacionPorcentual).toBe(0);
      expect(result.totalMesAnterior).toBe(0);
    });

    it('debe usar mes y anio actuales si no se especifican', async () => {
      mockPrisma.gasto.findMany.mockResolvedValue([]);

      const result = await service.obtenerEstadisticasGastos(tenantId);

      const now = new Date();
      expect(result.mes).toBe(now.getMonth());
      expect(result.anio).toBe(now.getFullYear());
    });
  });

  // ──────────────────────────────────────────────────────────────
  // OBTENER GASTO POR ID
  // ──────────────────────────────────────────────────────────────

  describe('obtenerGastoPorId', () => {
    it('debe retornar el gasto formateado si existe', async () => {
      mockPrisma.gasto.findUnique.mockResolvedValue(gastoBase);

      const result = await service.obtenerGastoPorId('gasto-01', tenantId);

      expect(result.id).toBe('gasto-01');
      expect(result.monto).toBe(45.50);
    });

    it('debe lanzar NotFoundException si el gasto no existe', async () => {
      mockPrisma.gasto.findUnique.mockResolvedValue(null);

      await expect(
        service.obtenerGastoPorId('gasto-no-existe', tenantId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // ACTUALIZAR GASTO
  // ──────────────────────────────────────────────────────────────

  describe('actualizarGasto', () => {
    it('debe actualizar un gasto existente', async () => {
      mockPrisma.gasto.findUnique.mockResolvedValue({ id: 'gasto-01', tenantId });
      mockPrisma.gasto.update.mockResolvedValue({ ...gastoBase, concepto: 'Luz electrica octubre' });

      const result = await service.actualizarGasto('gasto-01', tenantId, {
        concepto: 'Luz electrica octubre',
      } as any);

      expect(mockPrisma.gasto.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'gasto-01' },
        }),
      );
      expect(result.concepto).toBe('Luz electrica octubre');
    });

    it('debe lanzar NotFoundException si el gasto no existe o no pertenece al tenant', async () => {
      mockPrisma.gasto.findUnique.mockResolvedValue(null);

      await expect(
        service.actualizarGasto('gasto-no-existe', tenantId, { concepto: 'test' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar NotFoundException si el gasto pertenece a otro tenant', async () => {
      mockPrisma.gasto.findUnique.mockResolvedValue({ id: 'gasto-01', tenantId: 'otro-tenant' });

      await expect(
        service.actualizarGasto('gasto-01', tenantId, { concepto: 'test' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // ELIMINAR GASTO
  // ──────────────────────────────────────────────────────────────

  describe('eliminarGasto', () => {
    it('debe eliminar un gasto existente', async () => {
      mockPrisma.gasto.findUnique.mockResolvedValue({ id: 'gasto-01', tenantId });

      const result = await service.eliminarGasto('gasto-01', tenantId);

      expect(result.success).toBe(true);
      expect(mockPrisma.gasto.delete).toHaveBeenCalledWith({ where: { id: 'gasto-01' } });
    });

    it('debe lanzar NotFoundException si el gasto no existe', async () => {
      mockPrisma.gasto.findUnique.mockResolvedValue(null);

      await expect(
        service.eliminarGasto('gasto-no-existe', tenantId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
