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

    if (!storedToken.user.activo) {
      throw new UnauthorizedException('Cuenta desactivada');
    }

    // Revocar el token anterior (rotación)
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // Generar nuevos tokens
    const payload: JwtPayload = {
      sub: storedToken.user.id,
      email: storedToken.user.email,
      rol: storedToken.user.rol,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION', '15m') as any,
    });

    const newRefreshToken = randomBytes(64).toString('hex');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const expiresAt = this.calculateExpirationDate(refreshExpiresIn);

    await this.prisma.refreshToken.create({
      data: {
        userId: storedToken.user.id,
        token: newRefreshToken,
        expiresAt,
      },
    });

    this.logger.log(`Token refreshed para: ${storedToken.user.email}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout — Revoca el refresh token del usuario.
   */
  async logout(refreshToken: string): Promise<void> {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (storedToken && !storedToken.revoked) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      });
    }

    this.logger.log('Logout ejecutado');
  }

  /**
   * Solicitar Recuperación — Genera un token de un solo uso (TTL 1 hora).
   */
  async solicitarRecuperacion(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Siempre retornar el mismo mensaje (prevenir enumeración de usuarios)
    if (!user) {
      return { message: 'Si el email existe, recibirás instrucciones de recuperación' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // TODO: Integrar con Resend para enviar email con el link de recuperación
    this.logger.log(`Token de recuperación generado para: ${user.email}`);

    return { message: 'Si el email existe, recibirás instrucciones de recuperación' };
  }

  /**
   * Reset Password — Aplica nueva contraseña usando el token de recuperación.
   */
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
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
