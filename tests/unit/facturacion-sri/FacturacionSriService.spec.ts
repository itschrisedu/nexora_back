import { Test, TestingModule } from '@nestjs/testing';
import { FacturacionSriService } from '../../../src/bounded-contexts/facturacion-sri/application/FacturacionSriService';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../src/shared/infrastructure/encryption/encryption.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('FacturacionSriService (Pruebas Unitarias)', () => {
  let service: FacturacionSriService;
  let httpService: HttpService;
  let prisma: PrismaService;
  let encryption: EncryptionService;

  const mockHttpService = {
    post: jest.fn(),
    get: jest.fn(),
  };

  const mockPrisma = {
    businessConfig: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    facturaElectronica: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockEncryption = {
    encrypt: jest.fn((val) => `ENC:${val}`),
    decrypt: jest.fn((val) => val.replace('ENC:', '')),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('http://localhost:4000'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacturacionSriService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryption },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<FacturacionSriService>(FacturacionSriService);
    httpService = module.get<HttpService>(HttpService);
    prisma = module.get<PrismaService>(PrismaService);
    encryption = module.get<EncryptionService>(EncryptionService);
  });

  it('debe lanzar BadRequestException si el negocio no tiene certificado .p12 configurado', async () => {
    mockPrisma.businessConfig.findUnique.mockResolvedValue({
      id: 'cfg-1',
      tenantId: 'tenant-01',
      nombre: 'Calzado Cevallos',
      ruc: 'ENC:1801234567001',
      direccion: 'Cevallos Centro',
      firmaP12Path: null, // Sin firma
    });

    await expect(
      service.emitirFactura('tenant-01', {
        orderId: 'ord-01',
        fecha: new Date(),
        comprador: {
          tipoIdentificacion: '05',
          identificacion: '1809999999',
          razonSocial: 'Consumidor Final',
        },
        detalles: [
          {
            codigoProducto: 'ZAP-01',
            descripcion: 'Zapato Cuero Mocasín',
            cantidad: 2,
            precioUnitario: 25,
            tarifaIva: 0,
          },
        ],
        subtotalSinImpuestos: 50,
        totalDescuento: 0,
        totalConImpuestos: 50,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('debe armar el DTO con tarifa IVA 15% y emitir factura autorizada por el microservicio', async () => {
    // Firma simulada en formato base64 embebido
    const fakeBase64Firma = Buffer.from('fake-p12-signature-content').toString('base64');

    mockPrisma.businessConfig.findUnique.mockResolvedValue({
      id: 'cfg-1',
      tenantId: 'tenant-01',
      nombre: 'Calzados Cevallos',
      ruc: 'ENC:1801234567001',
      direccion: 'Av. 24 de Mayo y González Suárez',
      sriAmbiente: '1', // Pruebas
      sriEstablecimiento: '001',
      sriPuntoEmision: '001',
      sriSecuencialFactura: 1,
      sriObligadoContabilidad: false,
      firmaP12Path: `base64:${fakeBase64Firma}`,
      firmaPasswordEnc: 'ENC:Password123',
    });

    // Mock respuesta exitosa del microservicio SRI
    const fakeSriResponse = {
      data: {
        success: true,
        claveAcceso: '2810202601180123456700110010010000000011234567810',
        estado: 'AUTORIZADO',
        numeroAutorizacion: '2810202601180123456700110010010000000011234567810',
        fechaAutorizacion: '2026-10-28T10:00:00Z',
        xmlFirmado: '<factura>...</factura>',
        ridePdfBase64: 'JVBERi0xLjQK...',
        ridePdfUrl: '/comprobantes/factura-001.pdf',
      },
    };
    mockHttpService.post.mockReturnValue(of(fakeSriResponse));

    const fakeFacturaCreada = {
      id: 'factura-01',
      tenantId: 'tenant-01',
      claveAcceso: fakeSriResponse.data.claveAcceso,
      estadoSri: 'AUTORIZADO',
      numeroComprobante: '001-001-000000001',
    };
    mockPrisma.facturaElectronica.create.mockResolvedValue(fakeFacturaCreada);
    mockPrisma.facturaElectronica.update.mockResolvedValue(fakeFacturaCreada);
    mockPrisma.businessConfig.update.mockResolvedValue({});

    const resultado = await service.emitirFactura('tenant-01', {
      orderId: 'ord-100',
      fecha: new Date('2026-10-28'),
      comprador: {
        tipoIdentificacion: '05',
        identificacion: '1804567890',
        razonSocial: 'Juan Pérez',
        email: 'juan@test.com',
      },
      detalles: [
        {
          codigoProducto: 'BOT-01',
          descripcion: 'Bota Cuero Suela Track',
          cantidad: 1,
          precioUnitario: 40,
          tarifaIva: 15,
        },
      ],
      subtotalSinImpuestos: 40,
      totalDescuento: 0,
      totalConImpuestos: 46,
    });

    expect(resultado).toBeDefined();
    expect(resultado.estadoSri).toBe('AUTORIZADO');
    expect(resultado.claveAcceso).toBe(fakeSriResponse.data.claveAcceso);

    // Verificar llamada HTTP al endpoint /sri/emitir/factura
    expect(mockHttpService.post).toHaveBeenCalledWith(
      'http://localhost:4000/sri/emitir/factura',
      expect.objectContaining({
        ambiente: '1',
        emisor: expect.objectContaining({
          ruc: '1801234567001',
          establecimiento: '001',
          puntoEmision: '001',
        }),
        detalles: expect.arrayContaining([
          expect.objectContaining({
            codigoPrincipal: 'BOT-01',
            impuestos: expect.arrayContaining([
              expect.objectContaining({
                codigo: '2',
                tarifa: 15,
                codigoPorcentaje: '4', // Código porcentaje para IVA 15%
              }),
            ]),
          }),
        ]),
      }),
    );

    // Se creó inicialmente en estado PENDIENTE y luego se actualizó con la respuesta del SRI
    expect(mockPrisma.facturaElectronica.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-01',
          estadoSri: 'PENDIENTE',
        }),
      }),
    );
    expect(mockPrisma.facturaElectronica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'factura-01' },
        data: expect.objectContaining({
          claveAcceso: fakeSriResponse.data.claveAcceso,
          estadoSri: 'AUTORIZADO',
        }),
      }),
    );
  });

  it('debe consultar el estado de una factura y devolverla directamente si ya estaba AUTORIZADA', async () => {
    mockPrisma.facturaElectronica.findFirst.mockResolvedValue({
      id: 'fac-99',
      tenantId: 'tenant-01',
      claveAcceso: '2810202601180123456700110010010000000991234567810',
      estadoSri: 'AUTORIZADO',
    });

    const res = await service.consultarEstado('tenant-01', 'fac-99');
    expect(res.estadoSri).toBe('AUTORIZADO');
    expect(mockHttpService.get).not.toHaveBeenCalled();
  });

  it('debe listar todas las facturas electrónicas de la sucursal/tenant', async () => {
    mockPrisma.facturaElectronica.findMany.mockResolvedValue([
      { id: 'f-1', numeroComprobante: '001-001-000000001', total: 25 },
      { id: 'f-2', numeroComprobante: '001-001-000000002', total: 45 },
    ]);

    const lista = await service.listarFacturas('tenant-01');
    expect(lista).toHaveLength(2);
    expect(mockPrisma.facturaElectronica.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-01' },
      orderBy: { createdAt: 'desc' },
    });
  });
});
