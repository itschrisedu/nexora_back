import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * EncryptionService — Cifrado AES-256-GCM para datos sensibles (RUC, cédula).
 * Cada cifrado genera un IV único, garantizando que el mismo texto produce
 * diferentes ciphertexts (seguridad semántica).
 *
 * Formato almacenado: iv:authTag:ciphertext (todo en hex)
 */
@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const masterKey = this.configService.getOrThrow<string>('AES_MASTER_KEY');
    this.key = Buffer.from(masterKey, 'hex');

    if (this.key.length !== 32) {
      throw new Error(
        'AES_MASTER_KEY debe ser exactamente 32 bytes (64 caracteres hex)',
      );
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12); // 96 bits — estándar GCM
    const cipher = createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Formato de dato cifrado inválido');
    }

    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
