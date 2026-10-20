import { ClientesQueryService } from '../../../src/bounded-contexts/clientes/application/queries/ClientesQueryService';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

describe('ClientesQueryService — Campañas Promocionales y Cupones', () => {
  let queryService: ClientesQueryService;
  let mockPrisma: any;
  let mockEncryptionService: any;

  const tenantId = 'tenant-promo-01';

  const promoActiva = {
    id: 'promo-01',
    tenantId,
    codigo: 'DESCUENTO10',
    titulo: 'Descuento 10%',
    descripcion: 'Descuento por temporada',
    tipoDescuento: 'PORCENTAJE',
    valorDescuento: 10,
    minimoPares: 2,
    maximoCanjes: 5,
    canjesUsados: 2,
    aplicaPara: 'AMBAS',
    fechaFin: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días futuro
    activo: true,
    createdAt: new Date(),
  };

  const promoMontoFijo = {
    id: 'promo-02',
    tenantId,
    codigo: 'FIJO5',
    titulo: 'Descuento $5 fijo',
    tipoDescuento: 'MONTO_FIJO',
    valorDescuento: 5,
    minimoPares: 1,
    maximoCanjes: 10,
    canjesUsados: 0,
    aplicaPara: 'SOLO_CONTADO',
    fechaFin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    activo: true,
    createdAt: new Date(),
  };

  const promoDescuentoPorPar = {
    id: 'promo-03',
    tenantId,
    codigo: 'PORPAR2',
    titulo: 'Descuento $2 por par',
    tipoDescuento: 'DESCUENTO_POR_PAR',
    valorDescuento: 2,
    minimoPares: 1,
    maximoCanjes: 20,
    canjesUsados: 0,
    aplicaPara: 'AMBAS',
    fechaFin: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    activo: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    mockEncryptionService = {
      encrypt: jest.fn((str) => `enc-${str}`),
      decrypt: jest.fn((str) => str.replace('enc-', '')),
    };

    mockPrisma = {
      client: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      cobro: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ id: tenantId, businessConfig: { ruc: 'enc-1111111111001' } }),
        findMany: jest.fn().mockResolvedValue([{ id: tenantId, businessConfig: { ruc: 'enc-1111111111001' }, users: [] }]),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      creditLevelConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      campanaPromocion: {
        findMany: jest.fn().mockResolvedValue([promoActiva, promoMontoFijo, promoDescuentoPorPar]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.tenantId_codigo) {
            const { codigo } = where.tenantId_codigo;
            if (codigo === 'DESCUENTO10') return Promise.resolve(promoActiva);
            if (codigo === 'FIJO5') return Promise.resolve(promoMontoFijo);
            if (codigo === 'PORPAR2') return Promise.resolve(promoDescuentoPorPar);
          }
          return Promise.resolve(null);
        }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'promo-new', ...data })),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    queryService = new ClientesQueryService(mockPrisma as any, mockEncryptionService as any);
  });

  // ══════════════════════════════
  // OBTENER PROMOCIONES
  // ══════════════════════════════

  describe('obtenerPromociones', () => {
    it('debe listar todas las promociones del tenant', async () => {
      const promos = await queryService.obtenerPromociones(tenantId);
      expect(promos.length).toBe(3);
      expect(mockPrisma.campanaPromocion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
    });

    it('debe retornar lista vacía si no se proporciona tenantId', async () => {
      const promos = await queryService.obtenerPromociones('');
      expect(promos).toEqual([]);
    });
  });

  // ══════════════════════════════
  // CREAR PROMOCIÓN
  // ══════════════════════════════

  describe('crearPromocion', () => {
    it('debe crear una promoción válida con todos los campos', async () => {
      const fechaFutura = new Date();
      fechaFutura.setDate(fechaFutura.getDate() + 10);

      const dto = {
        titulo: 'Nueva Promo',
        codigo: 'NUEVA10',
        descripcion: 'Promo de prueba',
        tipoDescuento: 'PORCENTAJE',
        valorDescuento: 15,
        minimoPares: 3,
        maximoCanjes: 10,
        aplicaPara: 'AMBAS',
        fechaFin: fechaFutura.toISOString().split('T')[0],
      };

      const result = await queryService.crearPromocion(tenantId, dto);
      expect(result.id).toBe('promo-new');
      expect(mockPrisma.campanaPromocion.create).toHaveBeenCalled();
    });

    it('debe rechazar si el título está vacío', async () => {
      await expect(
        queryService.crearPromocion(tenantId, { titulo: '', codigo: 'X', fechaFin: '2027-01-01' }),
      ).rejects.toThrow('título de la campaña es obligatorio');
    });

    it('debe rechazar si el código está vacío', async () => {
      await expect(
        queryService.crearPromocion(tenantId, { titulo: 'Test', codigo: '', fechaFin: '2027-01-01' }),
      ).rejects.toThrow('código de validación de la campaña es obligatorio');
    });

    it('debe rechazar si la fecha de fin no está proporcionada', async () => {
      await expect(
        queryService.crearPromocion(tenantId, { titulo: 'Test', codigo: 'ABC' }),
      ).rejects.toThrow('fecha de vigencia de la campaña es obligatoria');
    });

    it('debe rechazar si la fecha de fin es pasada', async () => {
      await expect(
        queryService.crearPromocion(tenantId, { titulo: 'Test', codigo: 'ABC', fechaFin: '2020-01-01' }),
      ).rejects.toThrow('fecha de vigencia no puede ser una fecha pasada');
    });

    it('debe rechazar si ya existe una campaña activa con el mismo título', async () => {
      mockPrisma.campanaPromocion.findFirst.mockResolvedValueOnce({ id: 'promo-dup' });

      await expect(
        queryService.crearPromocion(tenantId, {
          titulo: 'Descuento 10%',
          codigo: 'NUEVO',
          fechaFin: '2027-06-01',
        }),
      ).rejects.toThrow('Ya existe una campaña activa');
    });

    it('debe rechazar si el código ya está en uso', async () => {
      mockPrisma.campanaPromocion.findUnique.mockResolvedValueOnce({ id: 'promo-cod-dup' });

      await expect(
        queryService.crearPromocion(tenantId, {
          titulo: 'Otra Promo',
          codigo: 'DESCUENTO10',
          fechaFin: '2027-06-01',
        }),
      ).rejects.toThrow('código de validación');
    });
  });

  // ══════════════════════════════
  // VALIDAR CUPÓN
  // ══════════════════════════════

  describe('validarCupon', () => {
    it('debe validar cupón con descuento porcentual correctamente', async () => {
      const result = await queryService.validarCupon(tenantId, 'DESCUENTO10', 3, 300);
      expect(result.valido).toBe(true);
      expect(result.descuentoCalculado).toBe(30); // 10% de $300
      expect(result.cuposRestantes).toBe(3); // 5 max - 2 usados
    });

    it('debe validar cupón con descuento de monto fijo', async () => {
      const result = await queryService.validarCupon(tenantId, 'FIJO5', 1, 50);
      expect(result.valido).toBe(true);
      expect(result.descuentoCalculado).toBe(5);
    });

    it('debe validar cupón con descuento por par', async () => {
      const result = await queryService.validarCupon(tenantId, 'PORPAR2', 6, 480);
      expect(result.valido).toBe(true);
      expect(result.descuentoCalculado).toBe(12); // $2 x 6 pares
    });

    it('debe rechazar cupón inexistente', async () => {
      const result = await queryService.validarCupon(tenantId, 'NOEXISTE', 1, 100);
      expect(result.valido).toBe(false);
      expect(result.mensaje).toContain('no existe o está inactivo');
    });

    it('debe rechazar cupón expirado', async () => {
      mockPrisma.campanaPromocion.findUnique.mockResolvedValueOnce({
        ...promoActiva,
        fechaFin: new Date('2020-01-01'),
      });
      const result = await queryService.validarCupon(tenantId, 'DESCUENTO10', 2, 200);
      expect(result.valido).toBe(false);
      expect(result.mensaje).toContain('expirado');
    });

    it('debe rechazar cupón que alcanzó el límite de canjes', async () => {
      mockPrisma.campanaPromocion.findUnique.mockResolvedValueOnce({
        ...promoActiva,
        canjesUsados: 5,
        maximoCanjes: 5,
      });
      const result = await queryService.validarCupon(tenantId, 'DESCUENTO10', 2, 200);
      expect(result.valido).toBe(false);
      expect(result.mensaje).toContain('límite de personas permitido');
    });

    it('debe rechazar si no se cumplen los pares mínimos', async () => {
      const result = await queryService.validarCupon(tenantId, 'DESCUENTO10', 1, 80);
      expect(result.valido).toBe(false);
      expect(result.mensaje).toContain('mínimo de 2 pares');
    });

    it('debe rechazar cupón SOLO_CONTADO si el pago es a crédito', async () => {
      const result = await queryService.validarCupon(tenantId, 'FIJO5', 1, 100, 'CREDITO');
      expect(result.valido).toBe(false);
      expect(result.mensaje).toContain('exclusivo para pagos de Contado');
    });

    it('debe aceptar cupón SOLO_CONTADO si el pago es de contado', async () => {
      const result = await queryService.validarCupon(tenantId, 'FIJO5', 1, 100, 'CONTADO');
      expect(result.valido).toBe(true);
    });

    it('debe rechazar cupón inactivo', async () => {
      mockPrisma.campanaPromocion.findUnique.mockResolvedValueOnce({
        ...promoActiva,
        activo: false,
      });
      const result = await queryService.validarCupon(tenantId, 'DESCUENTO10', 2, 200);
      expect(result.valido).toBe(false);
    });
  });

  // ══════════════════════════════
  // REGISTRAR CANJE
  // ══════════════════════════════

  describe('registrarCanjeCupon', () => {
    it('debe incrementar canjesUsados al registrar un canje', async () => {
      await queryService.registrarCanjeCupon(tenantId, 'DESCUENTO10');
      expect(mockPrisma.campanaPromocion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { canjesUsados: 3 },
        }),
      );
    });

    it('no debe hacer nada si el cupón no existe', async () => {
      mockPrisma.campanaPromocion.findUnique.mockResolvedValueOnce(null);
      await queryService.registrarCanjeCupon(tenantId, 'NOEXISTE');
      expect(mockPrisma.campanaPromocion.update).not.toHaveBeenCalled();
    });

    it('no debe incrementar si ya alcanzó el máximo de canjes', async () => {
      mockPrisma.campanaPromocion.findUnique.mockResolvedValueOnce({
        ...promoActiva,
        canjesUsados: 5,
        maximoCanjes: 5,
      });
      await queryService.registrarCanjeCupon(tenantId, 'DESCUENTO10');
      expect(mockPrisma.campanaPromocion.update).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════
  // ELIMINAR PROMOCIÓN
  // ══════════════════════════════

  describe('eliminarPromocion', () => {
    it('debe eliminar una promoción por id y tenantId', async () => {
      await queryService.eliminarPromocion('promo-01', tenantId);
      expect(mockPrisma.campanaPromocion.delete).toHaveBeenCalledWith({
        where: { id: 'promo-01', tenantId },
      });
    });
  });
});
