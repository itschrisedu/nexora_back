import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const mockConfigService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'AES_MASTER_KEY') {
          return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        }
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe cifrar y descifrar texto devolviendo el valor original', () => {
    const plaintext = '1723456789001'; // Ejemplo RUC
    const ciphertext = service.encrypt(plaintext);

    expect(ciphertext).toBeDefined();
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.split(':')).toHaveLength(3); // iv:tag:content

    const decrypted = service.decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('debe generar ciphertexts diferentes para el mismo plaintext (IV aleatorio)', () => {
    const plaintext = '1723456789001';
    const ciphertext1 = service.encrypt(plaintext);
    const ciphertext2 = service.encrypt(plaintext);

    expect(ciphertext1).not.toBe(ciphertext2);
  });
});
