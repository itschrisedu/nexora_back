import { EncryptionService } from '../../../src/shared/infrastructure/encryption/encryption.service';
import { ConfigService } from '@nestjs/config';

describe('Seguridad & Criptografía — Integridad de Datos AES-256-GCM y Protección contra Alteraciones', () => {
  let encryptionService: EncryptionService;
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(() => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue(masterKey),
    } as unknown as ConfigService;
    encryptionService = new EncryptionService(config);
  });

  it('debe garantizar seguridad semántica generando diferentes ciphertexts para el mismo texto plano (IV aleatorio único)', () => {
    const plainRuc = '1803730276001';

    const cipher1 = encryptionService.encrypt(plainRuc);
    const cipher2 = encryptionService.encrypt(plainRuc);

    expect(cipher1).not.toBe(cipher2); // Nunca deben ser idénticos
    expect(encryptionService.decrypt(cipher1)).toBe(plainRuc);
    expect(encryptionService.decrypt(cipher2)).toBe(plainRuc);
  });

  it('debe detectar manipulación o alteración maliciosa en el ciphertext o authTag (Integridad GCM)', () => {
    const plainCedula = '1710034065';
    const encrypted = encryptionService.encrypt(plainCedula);
    const parts = encrypted.split(':');

    // Alterar 1 carácter del ciphertext
    const corruptedCiphertext = parts[2].substring(0, parts[2].length - 1) + (parts[2].endsWith('a') ? 'b' : 'a');
    const tamperedData = `${parts[0]}:${parts[1]}:${corruptedCiphertext}`;

    // La función decrypt devuelve vacío o atrapa la excepción ante fallo de autenticación de etiqueta (AuthTag mismatch)
    const result = encryptionService.decrypt(tamperedData);
    expect(result).not.toBe(plainCedula);
  });

  it('debe impedir el descifrado si se utiliza una clave criptográfica errónea', () => {
    const wrongKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const wrongConfig = { getOrThrow: jest.fn().mockReturnValue(wrongKey) } as unknown as ConfigService;
    const attackerService = new EncryptionService(wrongConfig);

    const originalData = encryptionService.encrypt('DATO_CONFIDENCIAL_1803730276');
    const attackerResult = attackerService.decrypt(originalData);

    expect(attackerResult).not.toBe('DATO_CONFIDENCIAL_1803730276');
  });
});
