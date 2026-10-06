import { AuthService } from '../../src/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

jest.mock('../../src/auth/active-session.store', () => ({
  ActiveSessionStore: {
    isSessionOnline: jest.fn().mockReturnValue(false),
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('E2E / Sistema — Flujo de Autenticación, Emisión JWT y Control de Sesiones', () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockJwtService: JwtService;
  let mockConfigService: any;

  const validPassword = 'AdminPassword2026!';
  let hashedPassword = '';

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash(validPassword, 10);
  });

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.email === 'admin@calzadoscevallos.com') {
            return Promise.resolve({
              id: 'usr-admin-01',
              email: 'admin@calzadoscevallos.com',
              nombre: 'Christopher',
              apellido: 'Paucar',
              passwordHash: hashedPassword,
              rol: 'ROL_ADMIN',
              activo: true,
              tenantId: 'tenant-cevallos-matriz',
              tenant: { id: 'tenant-cevallos-matriz', name: 'Calzados Cevallos Matriz', active: true },
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'tenant-cevallos-matriz', active: true }),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: 'rt-123' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      businessConfig: {
        findUnique: jest.fn().mockResolvedValue({ id: 'bc-1', ruc: '1803730276001' }),
      },
    };

    mockJwtService = new JwtService({ secret: 'nexora-secret-key-2026' });

    mockConfigService = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'JWT_SECRET') return 'nexora-secret-key-2026';
        return def ?? '';
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'nexora-secret-key-2026';
        return 'nexora-secret-key-2026';
      }),
    };

    authService = new AuthService(mockPrisma, mockJwtService, mockConfigService);
  });

  it('debe completar el flujo E2E de login exitoso retornando tokens JWT y datos del usuario', async () => {
    const response = await authService.login(
      'admin@calzadoscevallos.com',
      validPassword,
      '192.168.1.50',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    );

    expect(response).toBeDefined();
    expect(response.accessToken).toBeDefined();
    expect(response.user).toBeDefined();
    expect(response.user.email).toBe('admin@calzadoscevallos.com');
    expect(response.user.rol).toBe('ROL_ADMIN');
    expect(response.user.tenantId).toBe('tenant-cevallos-matriz');

    // Verificar que el token JWT emitido es criptográficamente válido
    const decoded: any = mockJwtService.verify(response.accessToken);
    expect(decoded.sub).toBe('usr-admin-01');
    expect(decoded.rol).toBe('ROL_ADMIN');
    expect(decoded.tenantId).toBe('tenant-cevallos-matriz');
  });

  it('debe rechazar credenciales inválidas con UnauthorizedException', async () => {
    await expect(
      authService.login('admin@calzadoscevallos.com', 'PasswordIncorrecta!', '127.0.0.1', 'Navegador'),
    ).rejects.toThrow();
  });
});
