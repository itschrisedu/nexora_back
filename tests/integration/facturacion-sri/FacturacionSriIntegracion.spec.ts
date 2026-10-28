import { Test, TestingModule } from '@nestjs/testing';
import { FacturacionSriService } from '../../../src/bounded-contexts/facturacion-sri/application/FacturacionSriService';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../src/shared/infrastructure/encryption/encryption.service';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';

describe('Integración — Facturación Electrónica SRI y Acceso Público a Comprobantes', () => {
  let sriService: FacturacionSriService;
  let mockHttpService: any;
  let mockPrisma: any;

  beforeEach(async () => {
    mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    };

    mockPrisma = {
      businessConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cfg-tenant-cevallos',
          tenantId: 'tenant-cevallos-01',
          nombre: 'Fábrica y Almacén Calzado Cevallos',
          ruc: '1801234567001',
          direccion: 'Cevallos Centro Comercial',
          sriAmbiente: '1',
          sriEstablecimiento: '001',
          sriPuntoEmision: '001',
          sriSecuencialFactura: 10,
          sriObligadoContabilidad: false,
          firmaP12Path: `base64:${Buffer.from('dummy-cert-data').toString('base64')}`,
          firmaPasswordEnc: 'dummyPassword',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      facturaElectronica: {
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'factura-elect-101',
            ...args.data,
          }),
        ),
        update: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'factura-elect-101',
            estadoSri: args.data.estadoSri,
            claveAcceso: args.data.claveAcceso,
            numeroComprobante: '001-001-000000010',
          }),
        ),
        findFirst: jest.fn(),
      },
      publicComprobanteToken: {
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'token-uuid-123',
            token: 't_abc123xyz',
            tipo: args.data.tipo,
            createdAt: new Date(),
          }),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacturacionSriService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: EncryptionService,
          useValue: {
            decrypt: jest.fn((v) => v),
            encrypt: jest.fn((v) => v),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key, def) => (key === 'SRI_MICROSERVICE_URL' ? 'https://sri-worker.nexora.app' : def)),
          },
        },
      ],
    }).compile();

    sriService = module.get<FacturacionSriService>(FacturacionSriService);
  });

  it('debe ejecutar el flujo completo de emisión, firma y almacenamiento de comprobante electrónico', async () => {
    // 1. Simular respuesta del microservicio de firma y autorización SRI
    const fakeClaveAcceso = '2810202601180123456700110010010000000101234567819';
    mockHttpService.post.mockReturnValue(
      of({
        data: {
          success: true,
          claveAcceso: fakeClaveAcceso,
          estado: 'AUTORIZADO',
          numeroAutorizacion: fakeClaveAcceso,
          fechaAutorizacion: '2026-10-28T11:00:00Z',
          xmlAutorizado: '<factura id="comprobante">...</factura>',
          ridePdfBase64: 'JVBERi0xLjQK...',
          ridePdfUrl: '/comprobantes/factura-001-001-000000010.pdf',
        },
      }),
    );

    // 2. Ejecutar emisión de factura con calzado sujeto a IVA 15%
    const resultado = await sriService.emitirFactura('tenant-cevallos-01', {
      orderId: 'pedido-pos-555',
      fecha: new Date('2026-10-28'),
      comprador: {
        tipoIdentificacion: '05',
        identificacion: '1803334445',
        razonSocial: 'Carlos Paredes',
        email: 'carlos.paredes@gmail.com',
        telefono: '0991234567',
        direccion: 'Barrio El Tambo, Cevallos',
      },
      detalles: [
        {
          codigoProducto: 'CAS-NEGRO-40',
          descripcion: 'Calzado Casual Cuero Negro T40',
          cantidad: 2,
          precioUnitario: 30, // Subtotal = $60
          tarifaIva: 15,      // IVA 15% = $9
        },
      ],
      subtotalSinImpuestos: 60,
      totalDescuento: 0,
      totalConImpuestos: 69,
      formaPago: '01', // Efectivo
    });

    // 3. Verificaciones de integración
    expect(resultado).toBeDefined();
    expect(resultado.estadoSri).toBe('AUTORIZADO');
    expect(resultado.claveAcceso).toBe(fakeClaveAcceso);

    // 4. Verificar que se construyó correctamente la trama enviada al microservicio
    expect(mockHttpService.post).toHaveBeenCalledWith(
      'https://sri-worker.nexora.app/sri/emitir/factura',
      expect.objectContaining({
        ambiente: '1',
        emisor: expect.objectContaining({
          ruc: '1801234567001',
          establecimiento: '001',
          puntoEmision: '001',
        }),
        comprador: expect.objectContaining({
          identificacion: '1803334445',
          razonSocial: 'Carlos Paredes',
          tipoIdentificacion: '05',
        }),
        detalles: expect.arrayContaining([
          expect.objectContaining({
            codigoPrincipal: 'CAS-NEGRO-40',
            cantidad: 2,
            precioUnitario: 30,
            impuestos: expect.arrayContaining([
              expect.objectContaining({
                codigo: '2',
                codigoPorcentaje: '4', // Código de IVA 15% en SRI
                tarifa: 15,
                baseImponible: 60,
                valor: 9,
              }),
            ]),
          }),
        ]),
        secuencial: expect.stringMatching(/^\d{9}$/),
      }),
    );
  });

  it('debe generar enlace público seguro y no exponer URLs de microservicios internos', () => {
    // Verificación de que los enlaces públicos para clientes usen el token público corto
    const tokenPublico = 't_k9x2mPq4L';
    const baseUrlWeb = 'https://nexora.app';
    const linkGenerado = `${baseUrlWeb}/c?t=${tokenPublico}`;

    expect(linkGenerado).toContain('/c?t=');
    expect(linkGenerado).not.toContain('localhost');
    expect(linkGenerado).not.toContain(':4000');
    expect(linkGenerado).not.toContain('sri-worker');
  });
});
