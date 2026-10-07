import { AuthService } from '../../../src/auth/auth.service';
import * as bcrypt from 'bcryptjs';

// Mock del módulo ActiveSessionStore para evitar conflictos de sesión
jest.mock('../../../src/auth/active-session.store', () => ({
  ActiveSessionStore: {
    isSessionOnline: jest.fn().mockReturnValue(false),
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    touch: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('Integración — Autenticación, Roles y Criptografía de Sesión', () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockJwtService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('PasswordSegura123!', salt);

    mockPrisma = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where, include }) => {
          if (where.email === 'admin@calzadoscevallos.com') {
            return {
              id: 'user-admin-1',
              email: 'admin@calzadoscevallos.com',
              nombre: 'Christopher',
              apellido: 'Paucar',
              passwordHash,
              rol: 'ROL_ADMIN',
              tenantId: 'tenant-matriz-1',
              activo: true,
              intentosFallidos: 0,
              bloqueadoHasta: null,
              activeSessionId: null,
              sessionOtp: null,
              sessionOtpExpiresAt: null,
              sessionOtpAttempts: 0,
              esAdminGeneral: true,
              parentId: null,
              permiteCambiarPrecio: true,
              termsAcceptedAt: null,
              termsVersion: null,
              gpsConsentAt: null,
              tenant: { id: 'tenant-matriz-1', name: 'Calzados Cevallos Matriz' },
            };
          }
          return null;
        }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'rt-1', token: 'mock-refresh-token' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      businessConfig: {
        findUnique: jest.fn().mockResolvedValue({ duracionSesionHoras: 24 }),
      },
    };

    mockJwtService = {
      sign: jest.fn().mockImplementation((payload) => `jwt_token_for_${payload.sub}_role_${payload.rol}`),
      verify: jest.fn().mockImplementation(() => ({
        sub: 'user-admin-1',
        rol: 'ROL_ADMIN',
        tenantId: 'tenant-matriz-1',
      })),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('jwt-secret-key-cevallos'),
      getOrThrow: jest.fn().mockReturnValue('jwt-secret-key-cevallos'),
    };

    const mockEncryptionService = {
      encrypt: jest.fn((val: string) => `encrypted_${val}`),
      decrypt: jest.fn((val: string) => val.replace('encrypted_', '')),
    } as any;

    authService = new AuthService(mockPrisma, mockJwtService, mockConfigService, mockEncryptionService);
  });

  it('debe autenticar con credenciales validas y retornar token con tenantId y rol', async () => {
    const result: any = await authService.login(
      'admin@calzadoscevallos.com',
      'PasswordSegura123!',
    );

    expect(result.accessToken).toBeDefined();
    expect(result.user.email).toBe('admin@calzadoscevallos.com');
    expect(result.user.rol).toBe('ROL_ADMIN');
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-admin-1',
        rol: 'ROL_ADMIN',
        tenantId: 'tenant-matriz-1',
      }),
      expect.any(Object),
    );
  });

  it('debe rechazar inicio de sesion cuando la contrasena es incorrecta', async () => {
    await expect(
      authService.login(
        'admin@calzadoscevallos.com',
        'PasswordErronea999!',
      ),
    ).rejects.toThrow();
  });

  it('debe rechazar inicio de sesion cuando el usuario no existe', async () => {
    await expect(
      authService.login(
        'inexistente@empresa.com',
        'CualquierPassword123!',
      ),
    ).rejects.toThrow('Credenciales inválidas');
  });
});
