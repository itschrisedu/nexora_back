import { Test, TestingModule } from '@nestjs/testing';
import { FifoInventoryService } from '../../../src/bounded-contexts/inventario/application/services/FifoInventoryService';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';

describe('FifoInventoryService - Valoración FIFO de Inventario (Fase 3)', () => {
  let service: FifoInventoryService;
  let prisma: PrismaService;

  const mockPrisma = {
    inventoryLot: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    priceHistory: {
      create: jest.fn(),
    },
    productModel: {
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FifoInventoryService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<FifoInventoryService>(FifoInventoryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('debe registrar un nuevo lote de entrada con trazabilidad FIFO', async () => {
    const fakeLot = {
      id: 'lote-1',
      productId: 'prod-01',
      tallaId: 'talla-38',
      unitCost: 11.5,
      quantity: 12,
      remainingQuantity: 12,
      origin: 'ORDER_PURCHASE',
      entryDate: new Date(),
    };

    mockPrisma.inventoryLot.create.mockResolvedValue(fakeLot);

    const result = await service.registrarLoteEntrada({
      productId: 'prod-01',
      tallaId: 'talla-38',
      cantidad: 12,
      precioCosto: 11.5,
      origen: 'ORDER_PURCHASE',
      referenceId: 'OC-001',
    });

    expect(result).toBeDefined();
    expect(result?.id).toBe('lote-1');
    expect(mockPrisma.inventoryLot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'prod-01',
          tallaId: 'talla-38',
          unitCost: 11.5,
          quantity: 12,
          remainingQuantity: 12,
          origin: 'ORDER_PURCHASE',
        }),
      }),
    );
  });

  it('no debe registrar lote si la cantidad es 0 o negativa', async () => {
    const result = await service.registrarLoteEntrada({
      productId: 'prod-01',
      tallaId: 'talla-38',
      cantidad: 0,
      precioCosto: 12,
      origen: 'MANUAL_ENTRY',
    });

    expect(result).toBeNull();
    expect(mockPrisma.inventoryLot.create).not.toHaveBeenCalled();
  });

  it('debe descontar stock en estricto orden FIFO (lote más antiguo primero)', async () => {
    // Escenario:
    // Lote 1: 10 pares a $11 (Fecha: 2026-01-01)
    // Lote 2: 20 pares a $20 (Fecha: 2026-02-01)
    // Venta: 14 pares
    // Resultado esperado: 10 pares a $11 + 4 pares a $20 = Total 14 pares
    // Costo ponderado: ((10 * 11) + (4 * 20)) / 14 = (110 + 80) / 14 = $13.57

    const lote1 = {
      id: 'lote-1',
      productId: 'prod-01',
      tallaId: 'talla-38',
      unitCost: 11,
      quantity: 10,
      remainingQuantity: 10,
      entryDate: new Date('2026-01-01'),
    };

    const lote2 = {
      id: 'lote-2',
      productId: 'prod-01',
      tallaId: 'talla-38',
      unitCost: 20,
      quantity: 20,
      remainingQuantity: 20,
      entryDate: new Date('2026-02-01'),
    };

    mockPrisma.inventoryLot.findMany.mockResolvedValue([lote1, lote2]);
    mockPrisma.inventoryLot.update.mockResolvedValue({});

    const res = await service.descontarStockFifo({
      productId: 'prod-01',
      tallaId: 'talla-38',
      cantidad: 14,
    });

    expect(res.totalDescontado).toBe(14);
    expect(res.consumos).toHaveLength(2);
    expect(res.consumos[0]).toEqual({
      lotId: 'lote-1',
      unitCost: 11,
      quantity: 10,
    });
    expect(res.consumos[1]).toEqual({
      lotId: 'lote-2',
      unitCost: 20,
      quantity: 4,
    });

    expect(res.costoPromedioPonderado).toBeCloseTo(13.57, 2);

    // Verificar que lote 1 quedó en 0 y lote 2 en 16
    expect(mockPrisma.inventoryLot.update).toHaveBeenCalledWith({
      where: { id: 'lote-1' },
      data: { remainingQuantity: 0 },
    });
    expect(mockPrisma.inventoryLot.update).toHaveBeenCalledWith({
      where: { id: 'lote-2' },
      data: { remainingQuantity: 16 },
    });
  });

  it('debe obtener el costo unitario del lote activo vigente (el más antiguo no agotado)', async () => {
    mockPrisma.inventoryLot.findFirst.mockResolvedValue({
      unitCost: 14.5,
    });

    const costoActivo = await service.obtenerCostoFifoActivo('prod-01');
    expect(costoActivo).toBe(14.5);
  });

  it('debe recurrir al costo base del producto si no existen lotes FIFO registrados', async () => {
    mockPrisma.inventoryLot.findFirst.mockResolvedValue(null);
    mockPrisma.product.findUnique.mockResolvedValue({
      costPrice: 12.0,
    });

    const costoActivo = await service.obtenerCostoFifoActivo('prod-01');
    expect(costoActivo).toBe(12.0);
  });

  it('debe obtener el último costo de lote ingresado para sugerir en el modal de ingreso', async () => {
    mockPrisma.inventoryLot.findFirst.mockResolvedValue({
      unitCost: 16.0,
    });

    const ultimoCosto = await service.obtenerUltimoCostoLote('prod-01');
    expect(ultimoCosto).toBe(16.0);
  });

  it('debe transicionar automáticamente el precio de venta cuando un lote anterior queda en saldo 0 y se activa el siguiente lote', async () => {
    // Escenario:
    // Lote 1: 5 pares a costo $12 (agotándose en esta salida)
    // Lote 2: 24 pares a costo $16 (el siguiente lote que quedará activo)
    const lote1 = {
      id: 'lote-1',
      productId: 'prod-01',
      tallaId: 'talla-38',
      unitCost: 12,
      quantity: 5,
      remainingQuantity: 5,
      entryDate: new Date('2026-01-01'),
    };

    mockPrisma.inventoryLot.findMany.mockResolvedValue([lote1]);
    mockPrisma.inventoryLot.update.mockResolvedValue({});

    // Al agotarse el lote 1, el lote activo vigente siguiente es lote 2 con costo $16
    mockPrisma.inventoryLot.findFirst.mockResolvedValue({
      id: 'lote-2',
      productId: 'prod-01',
      unitCost: 16,
      remainingQuantity: 24,
    });

    mockPrisma.product.findUnique.mockResolvedValue({
      id: 'prod-01',
      costPrice: 12,
      salePrice: 16,
      modelId: 'modelo-01',
    });
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.priceHistory.create.mockResolvedValue({});

    const res = await service.descontarStockFifo({
      productId: 'prod-01',
      tallaId: 'talla-38',
      cantidad: 5,
    });

    expect(res.totalDescontado).toBe(5);
    // Verificamos que se actualizó el producto al nuevo costo $16 y nuevo PVP con margen (~$21.33)
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod-01' },
        data: expect.objectContaining({
          costPrice: 16,
          salePrice: expect.any(Number),
        }),
      }),
    );
    expect(mockPrisma.priceHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'prod-01',
          previousCostPrice: 12,
          newCostPrice: 16,
          changedById: 'FIFO_AUTO_TRANSITION',
        }),
      }),
    );
  });

  it('debe sincronizar hermanos del mismo modelo solo si no tienen lotes previos con saldo', async () => {
    const hermanoSinSaldo = {
      id: 'prod-02',
      modelId: 'modelo-01',
      color: 'Blanco',
      costPrice: 12,
      salePrice: 16,
    };

    mockPrisma.product.findMany.mockResolvedValue([hermanoSinSaldo]);
    // El hermano tiene 0 lotes con saldo remanente
    mockPrisma.inventoryLot.count.mockResolvedValue(0);
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.priceHistory.create.mockResolvedValue({});

    await service.sincronizarHermanosMismoModelo({
      modelId: 'modelo-01',
      sourceProductId: 'prod-01',
      nuevoCosto: 16,
      userId: 'admin-01',
      motivo: 'Nuevo lote ingresado a $16',
    });

    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod-02' },
        data: expect.objectContaining({
          costPrice: 16,
          salePrice: expect.any(Number),
        }),
      }),
    );
  });

  it('no debe sobreescribir el costo de un color hermano si pertenece a un proveedor diferente', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      id: 'prod-01',
      supplierId: 'prov-pedro',
    });

    const hermanoOtroProveedor = {
      id: 'prod-03',
      modelId: 'modelo-01',
      color: 'Café',
      supplierId: 'prov-maria', // Proveedor diferente
      costPrice: 14,
      salePrice: 18.67,
    };

    mockPrisma.product.findMany.mockResolvedValue([hermanoOtroProveedor]);
    mockPrisma.inventoryLot.count.mockResolvedValue(0);
    mockPrisma.product.update.mockClear();

    await service.sincronizarHermanosMismoModelo({
      modelId: 'modelo-01',
      sourceProductId: 'prod-01',
      nuevoCosto: 16,
      userId: 'admin-01',
      motivo: 'Nuevo lote de Don Pedro ingresado a $16',
    });

    // No debe actualizarse porque pertenece a Doña María
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});
