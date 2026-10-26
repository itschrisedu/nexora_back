import { ConfiguracionService } from '../../../src/configuracion/configuracion.service';

describe('ConfiguracionService - Estrategia Comercial Estándar vs Dinámico (Fase 9)', () => {
  let service: ConfiguracionService;
  let mockPrisma: any;
  let mockEncryption: any;
  let mockCloudinary: any;

  beforeEach(() => {
    mockPrisma = {
      businessConfig: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
      season: {
        findFirst: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'tenant-01', name: 'Matriz' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-01', name: 'Matriz' }),
      },
    };

    mockEncryption = {
      encrypt: jest.fn((val) => `enc_${val}`),
      decrypt: jest.fn((val) => (val?.startsWith('enc_') ? val.slice(4) : val)),
    };

    mockCloudinary = {
      uploadFile: jest.fn(),
    };

    service = new ConfiguracionService(mockPrisma, mockEncryption, mockCloudinary);
  });

  it('debe retornar modo ESTANDAR por defecto con reglas restrictivas desactivadas', async () => {
    const configData = {
      id: 'cfg-01',
      tenantId: 'tenant-01',
      estrategiaComercialTipo: 'ESTANDAR',
      margenMinimoDinamico: 25,
      temporadaComercial: 'AUTO',
    };
    mockPrisma.businessConfig.findUnique.mockResolvedValue(configData);
    mockPrisma.businessConfig.findFirst.mockResolvedValue(configData);
    mockPrisma.season.findFirst.mockResolvedValue(null);

    const estrategia = await service.getEstrategiaComercialVigente('tenant-01');

    expect(estrategia.estrategiaComercialTipo).toBe('ESTANDAR');
    expect(estrategia.reglas.validarMargenMinimo).toBe(false);
    expect(estrategia.reglas.habilitarPromocionesBaja).toBe(false);
  });

  it('debe activar la regla de validación de margen mínimo en modo DINAMICO durante temporada ALTA', async () => {
    const configData = {
      id: 'cfg-01',
      tenantId: 'tenant-01',
      estrategiaComercialTipo: 'DINAMICO',
      margenMinimoDinamico: 30,
      temporadaComercial: 'ALTA',
    };
    mockPrisma.businessConfig.findUnique.mockResolvedValue(configData);
    mockPrisma.businessConfig.findFirst.mockResolvedValue(configData);

    const estrategia = await service.getEstrategiaComercialVigente('tenant-01');

    expect(estrategia.estrategiaComercialTipo).toBe('DINAMICO');
    expect(estrategia.temporadaEfectiva).toBe('ALTA');
    expect(estrategia.margenMinimoDinamico).toBe(30);
    expect(estrategia.reglas.validarMargenMinimo).toBe(true);
    expect(estrategia.reglas.habilitarPromocionesBaja).toBe(false);
  });

  it('debe activar la regla de promociones de rotación en modo DINAMICO durante temporada BAJA', async () => {
    const configData = {
      id: 'cfg-01',
      tenantId: 'tenant-01',
      estrategiaComercialTipo: 'DINAMICO',
      descuentoTemporadaBaja: 15,
      temporadaComercial: 'BAJA',
    };
    mockPrisma.businessConfig.findUnique.mockResolvedValue(configData);
    mockPrisma.businessConfig.findFirst.mockResolvedValue(configData);

    const estrategia = await service.getEstrategiaComercialVigente('tenant-01');

    expect(estrategia.estrategiaComercialTipo).toBe('DINAMICO');
    expect(estrategia.temporadaEfectiva).toBe('BAJA');
    expect(estrategia.descuentoTemporadaBaja).toBe(15);
    expect(estrategia.reglas.validarMargenMinimo).toBe(false);
    expect(estrategia.reglas.habilitarPromocionesBaja).toBe(true);
  });
});
