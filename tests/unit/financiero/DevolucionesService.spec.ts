import { DevolucionesService } from '../../../src/bounded-contexts/financiero/application/DevolucionesService';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('DevolucionesService — Pruebas Unitarias', () => {
  let service: DevolucionesService;
  let mockPrisma: any;
  let mockTx: any;

  const tenantId = 'tenant-test-01';
  const userId = 'user-admin-01';

  beforeEach(() => {
    mockTx = {
      stockByTalla: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      cobro: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      client: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cli-01', saldoAFavor: 0 }),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId, nombre: 'Admin Test', email: 'admin@test.com' }),
      },
      movimientoFinanciero: {
        create: jest.fn().mockResolvedValue({}),
      },
      clienteDevolucion: {
        create: jest.fn().mockImplementation((args) => ({
          id: 'dev-cli-01',
          ...args.data,
          lines: args.data.lines?.create || [],
          createdAt: new Date(),
        })),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      deudaProveedor: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      supplier: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sup-01', saldoAFavorNegocio: 0 }),
        update: jest.fn(),
      },
      proveedorDevolucion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args) => ({
          id: 'dev-prov-01',
          ...args.data,
          lines: args.data.lines?.create || [],
          createdAt: new Date(),
        })),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
      clienteDevolucion: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn().mockImplementation((args) => ({
          id: 'dev-cli-manual-01',
          ...args.data,
          lines: args.data.lines?.create || [],
          createdAt: new Date(),
        })),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      proveedorDevolucion: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      client: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      cobro: {
        findFirst: jest.fn(),
      },
      supplier: {
        findFirst: jest.fn(),
      },
      deudaProveedor: {
        findFirst: jest.fn(),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tallaConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new DevolucionesService(mockPrisma);
  });

  // ──────────────────────────────────────────────────────────────
  // DEVOLUCIONES DE CLIENTE
  // ──────────────────────────────────────────────────────────────

  describe('registrarDevolucionCliente', () => {
    it('debe lanzar error si no se incluyen lineas de producto', async () => {
      await expect(
        service.registrarDevolucionCliente(
          { clientId: 'cli-01', motivo: 'Defectuoso', lines: [] },
          tenantId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe reingresar stock cuando destinoStock es REINGRESO_INVENTARIO', async () => {
      mockTx.stockByTalla.findFirst.mockResolvedValue({
        id: 'stock-01', productId: 'prod-01', tallaId: 'talla-39', quantity: 5,
      });
      mockTx.cobro.findMany.mockResolvedValue([]);

      await service.registrarDevolucionCliente(
        {
          clientId: 'cli-01',
          motivo: 'No fue la talla correcta',
          destinoStock: 'REINGRESO_INVENTARIO',
          lines: [{ productId: 'prod-01', tallaId: 'talla-39', cantidad: 2, precioUnitario: 35 }],
        },
        tenantId,
        userId,
      );

      expect(mockTx.stockByTalla.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'stock-01' },
          data: { quantity: 7 },
        }),
      );
    });

    it('no debe modificar stock cuando destinoStock es BAJA_POR_FALLA', async () => {
      mockTx.cobro.findMany.mockResolvedValue([]);

      await service.registrarDevolucionCliente(
        {
          clientId: 'cli-01',
          motivo: 'Calzado defectuoso',
          destinoStock: 'BAJA_POR_FALLA',
          lines: [{ productId: 'prod-01', tallaId: 'talla-39', cantidad: 1, precioUnitario: 45 }],
        },
        tenantId,
        userId,
      );

      expect(mockTx.stockByTalla.findFirst).not.toHaveBeenCalled();
      expect(mockTx.stockByTalla.update).not.toHaveBeenCalled();
    });

    it('debe descontar deuda del cliente por FIFO (cobros mas antiguos primero)', async () => {
      mockTx.cobro.findMany.mockResolvedValue([
        { id: 'cob-01', saleNoteId: 'sn-01', saldoPendiente: 30, montoTotal: 80, estado: 'PENDIENTE', createdAt: new Date('2026-01-01') },
        { id: 'cob-02', saleNoteId: 'sn-02', saldoPendiente: 50, montoTotal: 100, estado: 'PENDIENTE', createdAt: new Date('2026-02-01') },
      ]);

      await service.registrarDevolucionCliente(
        {
          clientId: 'cli-01',
          motivo: 'Devolucion de serie completa',
          destinoStock: 'REINGRESO_INVENTARIO',
          lines: [{ productId: 'prod-01', tallaId: 'talla-40', cantidad: 2, precioUnitario: 25 }],
        },
        tenantId,
        userId,
      );

      // totalDevuelto = 2 * 25 = 50
      // FIFO: cob-01 descuenta 30 (saldo 0 -> SALDADO), cob-02 descuenta 20 (saldo 30)
      expect(mockTx.cobro.update).toHaveBeenCalledTimes(2);
      expect(mockTx.cobro.update).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          where: { id: 'cob-01' },
          data: expect.objectContaining({ saldoPendiente: 0, estado: 'SALDADO' }),
        }),
      );
      expect(mockTx.cobro.update).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          where: { id: 'cob-02' },
          data: expect.objectContaining({ saldoPendiente: 30 }),
        }),
      );
    });

    it('debe generar saldo a favor si totalDevuelto > deudaTotal', async () => {
      mockTx.cobro.findMany.mockResolvedValue([
        { id: 'cob-01', saleNoteId: 'sn-01', saldoPendiente: 20, montoTotal: 50, estado: 'PENDIENTE', createdAt: new Date() },
      ]);
      mockTx.client.findUnique.mockResolvedValue({ id: 'cli-01', saldoAFavor: 10 });

      const result = await service.registrarDevolucionCliente(
        {
          clientId: 'cli-01',
          motivo: 'Error en envio',
          lines: [{ productId: 'prod-01', tallaId: 'talla-38', cantidad: 2, precioUnitario: 30 }],
        },
        tenantId,
        userId,
      );

      // totalDevuelto = 60, deuda = 20, saldoAFavor = 40
      expect(mockTx.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cli-01' },
          data: { saldoAFavor: 50 }, // 10 anterior + 40 nuevo
        }),
      );
      expect(result.resumenFinanciero.saldoAFavor).toBe(40);
    });

    it('debe marcar estado PENDIENTE_DEVOLUCION_PROVEEDOR cuando es BAJA_POR_FALLA', async () => {
      mockTx.cobro.findMany.mockResolvedValue([]);

      const result = await service.registrarDevolucionCliente(
        {
          clientId: 'cli-01',
          motivo: 'Calzado con falla de fabrica',
          destinoStock: 'BAJA_POR_FALLA',
          lines: [{ productId: 'prod-01', tallaId: 'talla-40', cantidad: 1, precioUnitario: 55 }],
        },
        tenantId,
        userId,
      );

      expect(mockTx.clienteDevolucion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            estado: 'PENDIENTE_DEVOLUCION_PROVEEDOR',
            destinoStock: 'BAJA_POR_FALLA',
          }),
        }),
      );
    });

    it('debe priorizar cobro especifico por saleNoteId en FIFO', async () => {
      mockTx.cobro.findMany.mockResolvedValue([
        { id: 'cob-01', saleNoteId: 'sn-A', saldoPendiente: 40, montoTotal: 40, estado: 'PENDIENTE', createdAt: new Date('2026-01-01') },
        { id: 'cob-02', saleNoteId: 'sn-B', saldoPendiente: 60, montoTotal: 60, estado: 'PENDIENTE', createdAt: new Date('2026-02-01') },
      ]);

      await service.registrarDevolucionCliente(
        {
          clientId: 'cli-01',
          saleNoteId: 'sn-B',
          motivo: 'Devolucion especifica',
          lines: [{ productId: 'prod-01', tallaId: 'talla-39', cantidad: 1, precioUnitario: 30 }],
        },
        tenantId,
        userId,
      );

      // Debe priorizar cob-02 (sn-B) primero
      expect(mockTx.cobro.update).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          where: { id: 'cob-02' },
        }),
      );
    });

    it('debe registrar movimiento financiero por cada cobro afectado', async () => {
      mockTx.cobro.findMany.mockResolvedValue([
        { id: 'cob-01', saleNoteId: 'sn-01', saldoPendiente: 25, montoTotal: 50, estado: 'PENDIENTE', createdAt: new Date() },
      ]);

      await service.registrarDevolucionCliente(
        {
          clientId: 'cli-01',
          motivo: 'Devolucion parcial',
          lines: [{ productId: 'prod-01', tallaId: 'talla-38', cantidad: 1, precioUnitario: 20 }],
        },
        tenantId,
        userId,
      );

      expect(mockTx.movimientoFinanciero.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tipo: 'DESCUENTO_DEVOLUCION_CLIENTE',
            referenciaTabla: 'Cobro',
            monto: 20,
          }),
        }),
      );
    });
  });

  describe('listarDevolucionesCliente', () => {
    it('debe listar devoluciones del tenant con lineas incluidas', async () => {
      mockPrisma.clienteDevolucion.findMany.mockResolvedValue([
        { id: 'dev-01', tenantId, lines: [{ id: 'line-01' }], createdAt: new Date() },
      ]);

      const result = await service.listarDevolucionesCliente(tenantId);

      expect(mockPrisma.clienteDevolucion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId },
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // PAGO DE EXCEDENTE AL CLIENTE
  // ──────────────────────────────────────────────────────────────

  describe('pagarExcedenteCliente', () => {
    it('debe lanzar error si la devolucion no existe', async () => {
      mockPrisma.clienteDevolucion.findFirst.mockResolvedValue(null);
      // Use the non-transactional findFirst (mockPrisma, not mockTx)
      // The service uses this.prisma directly for the initial find
      jest.spyOn(service as any, 'pagarExcedenteCliente');

      await expect(
        service.pagarExcedenteCliente('dev-no-existe', tenantId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar error si el excedente ya fue pagado', async () => {
      mockPrisma.clienteDevolucion.findFirst.mockResolvedValue({
        id: 'dev-01', saldoAFavorPagado: true, saldoAFavor: 20, clientId: 'cli-01',
      });

      await expect(
        service.pagarExcedenteCliente('dev-01', tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar error si la devolucion no tiene saldo a favor', async () => {
      mockPrisma.clienteDevolucion.findFirst.mockResolvedValue({
        id: 'dev-01', saldoAFavorPagado: false, saldoAFavor: 0, clientId: 'cli-01',
      });

      await expect(
        service.pagarExcedenteCliente('dev-01', tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe pagar el excedente, marcar como pagado y descontar del saldo del cliente', async () => {
      mockPrisma.clienteDevolucion.findFirst.mockResolvedValue({
        id: 'dev-01', saldoAFavorPagado: false, saldoAFavor: 35, clientId: 'cli-01',
      });
      mockTx.client.findUnique.mockResolvedValue({ id: 'cli-01', saldoAFavor: 50 });

      const result = await service.pagarExcedenteCliente('dev-01', tenantId, userId, 'EFECTIVO');

      expect(result.success).toBe(true);
      expect(result.montoPagado).toBe(35);
      expect(mockTx.clienteDevolucion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { saldoAFavorPagado: true } }),
      );
      expect(mockTx.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { saldoAFavor: 15 }, // 50 - 35
        }),
      );
      expect(mockTx.movimientoFinanciero.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tipo: 'PAGO_EXCEDENTE_CLIENTE' }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // APLICAR SALDO A FAVOR EN COBRO ("HACER PASO" CLIENTE)
  // ──────────────────────────────────────────────────────────────

  describe('aplicarSaldoFavorCliente', () => {
    it('debe lanzar error si el cliente no tiene saldo a favor', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ id: 'cli-01', saldoAFavor: 0 });

      await expect(
        service.aplicarSaldoFavorCliente(
          { clientId: 'cli-01', cobroId: 'cob-01' },
          tenantId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar error si el cobro no tiene saldo pendiente', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ id: 'cli-01', saldoAFavor: 50 });
      mockPrisma.cobro.findFirst.mockResolvedValue({ id: 'cob-01', saldoPendiente: 0 });

      await expect(
        service.aplicarSaldoFavorCliente(
          { clientId: 'cli-01', cobroId: 'cob-01' },
          tenantId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe aplicar saldo a favor al cobro y descontar del cliente', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ id: 'cli-01', saldoAFavor: 40 });
      mockPrisma.cobro.findFirst.mockResolvedValue({
        id: 'cob-01', saldoPendiente: 60, estado: 'PENDIENTE',
      });

      const result = await service.aplicarSaldoFavorCliente(
        { clientId: 'cli-01', cobroId: 'cob-01' },
        tenantId,
        userId,
      );

      expect(result.success).toBe(true);
      expect(result.montoAplicado).toBe(40); // min(40 saldo, 60 pendiente)
      expect(result.saldoRestanteCliente).toBe(0);
      expect(result.saldoRestanteCobro).toBe(20); // 60 - 40
    });

    it('debe saldar el cobro si el saldo a favor cubre el total', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ id: 'cli-01', saldoAFavor: 100 });
      mockPrisma.cobro.findFirst.mockResolvedValue({
        id: 'cob-01', saldoPendiente: 30, estado: 'PENDIENTE',
      });

      const result = await service.aplicarSaldoFavorCliente(
        { clientId: 'cli-01', cobroId: 'cob-01' },
        tenantId,
        userId,
      );

      expect(result.montoAplicado).toBe(30);
      expect(result.saldoRestanteCobro).toBe(0);
      expect(result.saldoRestanteCliente).toBe(70);
    });

    it('debe respetar montoAplicar parcial cuando se especifica', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ id: 'cli-01', saldoAFavor: 80 });
      mockPrisma.cobro.findFirst.mockResolvedValue({
        id: 'cob-01', saldoPendiente: 100, estado: 'PENDIENTE',
      });

      const result = await service.aplicarSaldoFavorCliente(
        { clientId: 'cli-01', cobroId: 'cob-01', montoAplicar: 25 },
        tenantId,
        userId,
      );

      expect(result.montoAplicado).toBe(25);
      expect(result.saldoRestanteCliente).toBe(55); // 80 - 25
      expect(result.saldoRestanteCobro).toBe(75); // 100 - 25
    });
  });

  // ──────────────────────────────────────────────────────────────
  // DEVOLUCIONES A PROVEEDOR
  // ──────────────────────────────────────────────────────────────

  describe('registrarDevolucionProveedor', () => {
    it('debe lanzar error si no se incluyen lineas de producto', async () => {
      await expect(
        service.registrarDevolucionProveedor(
          { supplierId: 'sup-01', motivo: 'Garantia', lines: [] },
          tenantId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe descontar stock fisico por cada linea devuelta', async () => {
      mockTx.stockByTalla.findFirst.mockResolvedValue({
        id: 'stock-01', quantity: 10,
      });
      mockTx.deudaProveedor.findMany.mockResolvedValue([]);

      await service.registrarDevolucionProveedor(
        {
          supplierId: 'sup-01',
          motivo: 'Falla de fabrica lote 2026',
          lines: [{ productId: 'prod-01', tallaId: 'talla-39', cantidad: 3, precioCosto: 22 }],
        },
        tenantId,
        userId,
      );

      expect(mockTx.stockByTalla.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantity: 7 }, // 10 - 3
        }),
      );
    });

    it('debe descontar deuda del proveedor por FIFO', async () => {
      mockTx.stockByTalla.findFirst.mockResolvedValue({ id: 'stock-01', quantity: 5 });
      mockTx.deudaProveedor.findMany.mockResolvedValue([
        { id: 'deuda-01', entradaId: 'ent-A', saldoPendiente: 30, montoTotal: 80, estado: 'PENDIENTE', createdAt: new Date('2026-01-01') },
        { id: 'deuda-02', entradaId: 'ent-B', saldoPendiente: 100, montoTotal: 200, estado: 'PENDIENTE', createdAt: new Date('2026-03-01') },
      ]);

      await service.registrarDevolucionProveedor(
        {
          supplierId: 'sup-01',
          motivo: 'Garantia por defecto',
          lines: [{ productId: 'prod-01', tallaId: 'talla-40', cantidad: 2, precioCosto: 25 }],
        },
        tenantId,
        userId,
      );

      // totalDevuelto = 2 * 25 = 50
      // FIFO: deuda-01 descuenta 30 (saldado), deuda-02 descuenta 20 (queda 80)
      expect(mockTx.deudaProveedor.update).toHaveBeenCalledTimes(2);
      expect(mockTx.deudaProveedor.update).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          where: { id: 'deuda-01' },
          data: expect.objectContaining({ saldoPendiente: 0, estado: 'SALDADO' }),
        }),
      );
      expect(mockTx.deudaProveedor.update).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          where: { id: 'deuda-02' },
          data: expect.objectContaining({ saldoPendiente: 80 }),
        }),
      );
    });

    it('debe generar saldo a favor del negocio si totalDevuelto > deudaTotal', async () => {
      mockTx.stockByTalla.findFirst.mockResolvedValue({ id: 'stock-01', quantity: 10 });
      mockTx.deudaProveedor.findMany.mockResolvedValue([
        { id: 'deuda-01', saldoPendiente: 20, montoTotal: 50, estado: 'PENDIENTE', createdAt: new Date() },
      ]);
      mockTx.supplier.findUnique.mockResolvedValue({ id: 'sup-01', saldoAFavorNegocio: 5 });

      const result = await service.registrarDevolucionProveedor(
        {
          supplierId: 'sup-01',
          motivo: 'Garantia',
          lines: [{ productId: 'prod-01', tallaId: 'talla-38', cantidad: 3, precioCosto: 30 }],
        },
        tenantId,
        userId,
      );

      // totalDevuelto = 90, deuda = 20, saldoAFavor = 70
      expect(mockTx.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { saldoAFavorNegocio: 75 }, // 5 anterior + 70 nuevo
        }),
      );
      expect(result.resumenFinanciero.saldoAFavor).toBe(70);
    });

    it('debe marcar devolucion de cliente como COMPLETADO si viene de una', async () => {
      mockTx.stockByTalla.findFirst.mockResolvedValue({ id: 'stock-01', quantity: 5 });
      mockTx.deudaProveedor.findMany.mockResolvedValue([]);

      await service.registrarDevolucionProveedor(
        {
          supplierId: 'sup-01',
          motivo: 'Garantia desde devolucion cliente',
          clienteDevolucionId: 'dev-cli-01',
          lines: [{ productId: 'prod-01', tallaId: 'talla-39', cantidad: 1, precioCosto: 40 }],
        },
        tenantId,
        userId,
      );

      expect(mockTx.clienteDevolucion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dev-cli-01' },
          data: { estado: 'COMPLETADO' },
        }),
      );
    });

    it('debe asignar correlativo DEV-XXXX incremental', async () => {
      mockTx.stockByTalla.findFirst.mockResolvedValue({ id: 'stock-01', quantity: 5 });
      mockTx.deudaProveedor.findMany.mockResolvedValue([]);
      mockTx.proveedorDevolucion.findFirst.mockResolvedValue({ numero: 7 });

      const result = await service.registrarDevolucionProveedor(
        {
          supplierId: 'sup-01',
          motivo: 'Garantia lote',
          lines: [{ productId: 'prod-01', tallaId: 'talla-39', cantidad: 1, precioCosto: 25 }],
        },
        tenantId,
        userId,
      );

      expect(result.resumenFinanciero.numeroCodigo).toBe('DEV-0008');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // PAGO EXCEDENTE PROVEEDOR
  // ──────────────────────────────────────────────────────────────

  describe('recibirPagoExcedenteProveedor', () => {
    it('debe lanzar error si la devolucion no existe', async () => {
      mockPrisma.proveedorDevolucion.findFirst.mockResolvedValue(null);

      await expect(
        service.recibirPagoExcedenteProveedor('dev-no-existe', tenantId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar error si ya fue pagado', async () => {
      mockPrisma.proveedorDevolucion.findFirst.mockResolvedValue({
        id: 'dev-prov-01', saldoAFavorPagado: true, saldoAFavor: 30, supplierId: 'sup-01',
      });

      await expect(
        service.recibirPagoExcedenteProveedor('dev-prov-01', tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe registrar el pago y descontar del saldo del proveedor', async () => {
      mockPrisma.proveedorDevolucion.findFirst.mockResolvedValue({
        id: 'dev-prov-01', saldoAFavorPagado: false, saldoAFavor: 45, supplierId: 'sup-01',
      });
      mockTx.supplier.findUnique.mockResolvedValue({ id: 'sup-01', saldoAFavorNegocio: 100 });

      const result = await service.recibirPagoExcedenteProveedor('dev-prov-01', tenantId, userId, 'TRANSFERENCIA');

      expect(result.success).toBe(true);
      expect(result.montoRecibido).toBe(45);
      expect(result.metodo).toBe('TRANSFERENCIA');
      expect(mockTx.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { saldoAFavorNegocio: 55 }, // 100 - 45
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // APLICAR SALDO A FAVOR PROVEEDOR ("HACER PASO")
  // ──────────────────────────────────────────────────────────────

  describe('aplicarSaldoFavorProveedor', () => {
    it('debe lanzar error si no hay saldo a favor con el proveedor', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue({ id: 'sup-01', saldoAFavorNegocio: 0 });

      await expect(
        service.aplicarSaldoFavorProveedor(
          { supplierId: 'sup-01', deudaId: 'deuda-01' },
          tenantId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar error si la deuda no tiene saldo pendiente', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue({ id: 'sup-01', saldoAFavorNegocio: 50 });
      mockPrisma.deudaProveedor.findFirst.mockResolvedValue({ id: 'deuda-01', saldoPendiente: 0 });

      await expect(
        service.aplicarSaldoFavorProveedor(
          { supplierId: 'sup-01', deudaId: 'deuda-01' },
          tenantId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe aplicar saldo a favor a la deuda del proveedor', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue({ id: 'sup-01', saldoAFavorNegocio: 80 });
      mockPrisma.deudaProveedor.findFirst.mockResolvedValue({
        id: 'deuda-01', saldoPendiente: 120, estado: 'PENDIENTE',
      });

      const result = await service.aplicarSaldoFavorProveedor(
        { supplierId: 'sup-01', deudaId: 'deuda-01' },
        tenantId,
        userId,
      );

      expect(result.success).toBe(true);
      expect(result.montoAplicado).toBe(80); // min(80 saldo, 120 deuda)
      expect(result.saldoRestanteNegocio).toBe(0);
      expect(result.saldoRestanteDeuda).toBe(40); // 120 - 80
    });

    it('debe saldar la deuda si el saldo a favor cubre el total', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue({ id: 'sup-01', saldoAFavorNegocio: 200 });
      mockPrisma.deudaProveedor.findFirst.mockResolvedValue({
        id: 'deuda-01', saldoPendiente: 50, estado: 'PENDIENTE',
      });

      const result = await service.aplicarSaldoFavorProveedor(
        { supplierId: 'sup-01', deudaId: 'deuda-01' },
        tenantId,
        userId,
      );

      expect(result.montoAplicado).toBe(50);
      expect(result.saldoRestanteDeuda).toBe(0);
      expect(result.saldoRestanteNegocio).toBe(150);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // MERCADERIA POR DEVOLVER MANUAL
  // ──────────────────────────────────────────────────────────────

  describe('registrarMercaderiaPorDevolverManual', () => {
    it('debe lanzar error si no incluye lineas', async () => {
      await expect(
        service.registrarMercaderiaPorDevolverManual(
          { motivo: 'Defectuoso', lines: [] },
          tenantId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe crear devolucion manual con estado PENDIENTE_DEVOLUCION_PROVEEDOR', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ id: 'cli-generico' });

      const result = await service.registrarMercaderiaPorDevolverManual(
        {
          motivo: 'Zapato con suela despegada',
          lines: [{ productId: 'prod-01', tallaId: 'talla-39', cantidad: 2, precioUnitario: 20 }],
        },
        tenantId,
        userId,
      );

      expect(mockPrisma.clienteDevolucion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            estado: 'PENDIENTE_DEVOLUCION_PROVEEDOR',
            destinoStock: 'BAJA_POR_FALLA',
            motivo: expect.stringContaining('[MANUAL/BODEGA]'),
          }),
        }),
      );
    });
  });
});
