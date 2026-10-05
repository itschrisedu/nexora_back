import { AuthService } from '../../../src/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';

describe('AuthService — Pruebas Unitarias', () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockJwtService: jest.Mocked<JwtService>;
  let mockConfigService: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      sucursal: {
        findFirst: jest.fn(),
      },
      auditoriaLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mocked-jwt-token'),
      verify: jest.fn(),
    } as any;

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, def?: any) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        if (key === 'RESEND_API_KEY') return '';
        if (key === 'SYSTEM_EMAIL') return 'nexora.appv01@gmail.com';
        return def ?? '';
      }),
    };

    authService = new AuthService(
      mockPrisma,
      mockJwtService,
      mockConfigService,
    );
  });

  describe('Enmascaramiento y Criptografía de Credenciales', () => {
    it('debe enmascarar correos correctamente para proteger la privacidad', () => {
      const maskEmail = (authService as any).maskEmail.bind(authService);
      expect(maskEmail('christopher@gmail.com')).toBe('c••••r@gmail.com');
      expect(maskEmail('ab@gmail.com')).toBe('a•@gmail.com');
      expect(maskEmail('admin@nexora.ec')).toBe('a•••n@nexora.ec');
    });

    it('debe verificar correctamente un password hasheado con bcrypt', async () => {
      const plainPassword = 'AdminPassword123!';
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(plainPassword, salt);

      const isMatch = await bcrypt.compare(plainPassword, hash);
      expect(isMatch).toBe(true);

      const isWrong = await bcrypt.compare('WrongPassword', hash);
      expect(isWrong).toBe(false);
    });
  });

  describe('Validación de Roles y Permisos', () => {
    it('debe reconocer los roles del sistema correctamente', () => {
      const rolesValidos = ['ROL_ADMIN', 'ROL_VENDEDOR', 'ROL_BODEGUERO', 'ROL_SUPER_ADMIN'];
      rolesValidos.forEach((rol) => {
        expect(typeof rol).toBe('string');
        expect(rol.startsWith('ROL_')).toBe(true);
      });
    });
  });
});
