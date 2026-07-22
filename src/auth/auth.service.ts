import {
  Injectable,
  UnauthorizedException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
import { JwtPayload } from './jwt.strategy';
import { Rol } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Login — Autentica al usuario y retorna access + refresh tokens.
   */
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.activo) {
      throw new UnauthorizedException('Cuenta desactivada. Contacte al administrador');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      rol: user.rol,
      tenantId: user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION', '15m') as any,
    });

    const refreshToken = randomBytes(64).toString('hex');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const expiresAt = this.calculateExpirationDate(refreshExpiresIn);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt,
      },
    });

    this.logger.log(`Login exitoso para: ${user.email} (${user.rol})`);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
        tenantId: user.tenantId,
      },
    };
  }

  /**
   * Refresh Token — Genera un nuevo access token a partir de un refresh token válido.
   */
  async refreshToken(token: string) {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (storedToken.revoked) {
      this.logger.warn(`Intento de uso de refresh token revocado: userId=${storedToken.userId}`);
      throw new UnauthorizedException('Refresh token revocado');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    const payload: JwtPayload = {
      sub: storedToken.user.id,
      email: storedToken.user.email,
      rol: storedToken.user.rol,
      tenantId: storedToken.user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION', '15m') as any,
    });

    return { accessToken };
  }

  /**
   * Logout — Revoca el refresh token.
   */
  async logout(token: string) {
    await this.prisma.refreshToken.update({
      where: { token },
      data: { revoked: true },
    });
  }

  /**
   * Solicitar recuperación de contraseña.
   */
  async solicitarRecuperacion(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Por seguridad no revelamos si existe o no el usuario
      return { message: 'Si el correo existe en nuestro sistema, recibirás instrucciones para restablecer tu contraseña.' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora de validez

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    this.logger.log(`Solicitud de recuperación de contraseña para: ${email}. Token: ${token}`);
    
    // Aquí se enviaría el email si estuviera configurado
    return { message: 'Si el correo existe en nuestro sistema, recibirás instrucciones para restablecer tu contraseña.', debugToken: token };
  }

  /**
   * Restablecer contraseña con token.
   */
  async resetPassword(token: string, newPassword: string) {
    const resetRecord = await this.prisma.passwordReset.findUnique({
      where: { token },
    });

    if (!resetRecord) {
      throw new NotFoundException('Token de recuperación inválido');
    }

    if (resetRecord.usedAt) {
      throw new UnauthorizedException('Este token ya fue utilizado');
    }

    if (resetRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de recuperación expirado');
    }

    const passwordHash = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      // Revocar todos los refresh tokens del usuario (forzar re-login)
      this.prisma.refreshToken.updateMany({
        where: { userId: resetRecord.userId, revoked: false },
        data: { revoked: true },
      }),
    ]);

    this.logger.log(`Contraseña reseteada para userId: ${resetRecord.userId}`);

    return { message: 'Contraseña actualizada exitosamente. Inicia sesión con tu nueva contraseña.' };
  }

  // ── Gestión de Personal (Admin CRUD) ──────────

  async listUsers(requestUser: { id: string; rol: string; tenantId: string | null }) {
    const where: any = {};

    if (requestUser.rol === 'ROL_SUPER_ADMIN') {
      // Super Admin ve todos los usuarios
    } else if (requestUser.rol === 'ROL_ADMIN') {
      // Admin ve solo a los usuarios de su tenant (excluyéndose a sí mismo opcionalmente)
      where.tenantId = requestUser.tenantId;
      where.rol = { in: [Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_ADMIN] };
    } else {
      // Vendedores y bodegueros no deberían listar usuarios
      return [];
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        activo: true,
        tenantId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createUser(
    email: string,
    nombre: string,
    rol: Rol,
    password: string,
    requestUser: { id: string; rol: string; tenantId: string | null },
    explicitTenantId?: string,
  ) {
    // Validación de permisos: solo Super Admin puede crear Admins
    if (rol === Rol.ROL_ADMIN && requestUser.rol !== 'ROL_SUPER_ADMIN') {
      throw new UnauthorizedException('Solo un Super Admin puede crear administradores.');
    }
    if (rol === Rol.ROL_SUPER_ADMIN) {
      throw new UnauthorizedException('No se puede crear otro Super Admin.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new UnauthorizedException('El correo ya está registrado.');
    }

    // Determinar el tenantId del nuevo usuario
    let tenantId: string | null = null;
    if (requestUser.rol === 'ROL_SUPER_ADMIN') {
      // Super Admin puede asignar a un tenant específico mediante explicitTenantId
      if (explicitTenantId) {
        tenantId = explicitTenantId;
      } else {
        tenantId = requestUser.tenantId;
      }
    } else {
      // Admin crea personal en su propio tenant
      tenantId = requestUser.tenantId;
    }

    const passwordHash = await bcrypt.hash(password, this.BCRYPT_ROUNDS);
    return this.prisma.user.create({
      data: {
        email,
        nombre,
        rol,
        passwordHash,
        activo: true,
        tenantId,
        parentId: requestUser.id,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        activo: true,
        tenantId: true,
      },
    });
  }

  async toggleUserActive(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    return this.prisma.user.update({
      where: { id },
      data: { activo: !user.activo },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        activo: true,
      },
    });
  }

  // ── Utilidades ──────────────────────────────

  private calculateExpirationDate(duration: string): Date {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // default 7 días
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * multipliers[unit]);
  }
}
