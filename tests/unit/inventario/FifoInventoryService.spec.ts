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
    },
    product: {
      findUnique: jest.fn(),
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
      id: 'lote-activo',
      productId: 'prod-01',
      unitCost: 14.5,
      remainingQuantity: 5,
    });

    const costoActivo = await service.obtenerCostoUnitarioActivo('prod-01');
    expect(costoActivo).toBe(14.5);
  });

  it('debe recurrir al costo base del producto si no existen lotes FIFO registrados', async () => {
    mockPrisma.inventoryLot.findFirst.mockResolvedValue(null);
    mockPrisma.product.findUnique.mockResolvedValue({
      id: 'prod-01',
      costPrice: 12.0,
      price: 25.0,
    });

    const costoActivo = await service.obtenerCostoUnitarioActivo('prod-01');
    expect(costoActivo).toBe(12.0);
  });
});
