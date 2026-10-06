import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

describe('Seguridad & Autenticación — Robustez de Hashes Bcrypt, Firmas JWT y Control de Expiración', () => {
  const jwtSecret = 'nexora-secret-key-for-security-tests-2026';
  let jwtService: JwtService;

  beforeAll(() => {
    jwtService = new JwtService({ secret: jwtSecret });
  });

  it('debe generar hashes de contraseña irreversibles con factor de costo (salt rounds >= 10)', async () => {
    const passwordOriginal = 'ClaveComercianteSegura2026!';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(passwordOriginal, salt);

    expect(hash).not.toBe(passwordOriginal);
    expect(hash).toMatch(/^\$2[aby]\$10\$/); // Identificador estándar de algoritmo bcrypt con costo 10
    expect(await bcrypt.compare(passwordOriginal, hash)).toBe(true);
    expect(await bcrypt.compare('ClaveIncorrecta!', hash)).toBe(false);
  });

  it('debe rechazar tokens JWT manipulados en su carga útil o firma digital', () => {
    const payload = { sub: 'usr-admin-01', rol: 'ROL_ADMIN', tenantId: 'tenant-01' };
    const validToken = jwtService.sign(payload);

    // Alterar la firma del token (última sección del JWT)
    const tokenParts = validToken.split('.');
    const corruptedToken = `${tokenParts[0]}.${tokenParts[1]}.FirmaFalsificadaInvalida123`;

    expect(() => jwtService.verify(corruptedToken)).toThrow();
  });

  it('debe rechazar tokens JWT expirados según política de seguridad temporal', async () => {
    const expiredToken = jwtService.sign(
      { sub: 'usr-test' },
      { expiresIn: '0s' }, // Expira inmediatamente
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(() => jwtService.verify(expiredToken)).toThrow();
  });
});
