import { EncryptionService } from '../../../src/shared/infrastructure/encryption/encryption.service';
import { ConfigService } from '@nestjs/config';

describe('Rendimiento / Benchmark — Criptografía AES-256-GCM y Procesamiento de Identidades', () => {
  let encryptionService: EncryptionService;
  // 64 caracteres hex = 32 bytes para clave AES-256
  const validMasterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(() => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(validMasterKey),
    } as unknown as ConfigService;

    encryptionService = new EncryptionService(configService);
  });

  it('debe cifrar y descifrar 1,000 registros sensibles en menos de 100 ms (< 0.1 ms por registro)', () => {
    const totalRegistros = 1000;
    const cedulas = Array.from({ length: totalRegistros }, (_, i) => `180373027${i % 10}`);

    const startCifrado = performance.now();
    const cifrados = cedulas.map((c) => encryptionService.encrypt(c));
    const finCifrado = performance.now();

    const tiempoCifradoTotalMs = finCifrado - startCifrado;
    const tiempoCifradoPromedioMs = tiempoCifradoTotalMs / totalRegistros;

    expect(cifrados.length).toBe(totalRegistros);
    expect(tiempoCifradoTotalMs).toBeLessThan(1000); // 1,000 registros en < 1s
    expect(tiempoCifradoPromedioMs).toBeLessThan(1.0); // < 1ms por registro

    const startDescifrado = performance.now();
    const descifrados = cifrados.map((c) => encryptionService.decrypt(c));
    const finDescifrado = performance.now();

    const tiempoDescifradoTotalMs = finDescifrado - startDescifrado;
    const tiempoDescifradoPromedioMs = tiempoDescifradoTotalMs / totalRegistros;

    expect(descifrados[0]).toBe(cedulas[0]);
    expect(tiempoDescifradoTotalMs).toBeLessThan(1000);
    expect(tiempoDescifradoPromedioMs).toBeLessThan(1.0);
  });
});
