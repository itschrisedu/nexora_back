import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../shared/infrastructure/encryption/encryption.service';
import { ActiveSessionStore } from './active-session.store';

export interface JwtPayload {
  sub: string;
  email: string;
  rol: string;
  tenantId: string | null;
  sessionId?: string;
}

/**
 * JwtStrategy — Estrategia Passport para validar access tokens JWT.
 * Extrae el token del header Authorization: Bearer <token>
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload) {
    let user: any = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          rol: true,
          activo: true,
          nombre: true,
          tenantId: true,
          permiteCambiarPrecio: true,
          activeSessionId: true,
          esAdminGeneral: true,
        },
      });
    } catch (dbError: any) {
      // Si la base de datos está temporalmente inaccesible o en modo offline,
      // el token ya fue validado criptográficamente por Passport con JWT_SECRET.
      // Retornar el usuario con los claims del token para NO invalidar la sesión del usuario.
      return {
        id: payload.sub,
        sub: payload.sub,
        email: payload.email,
        rol: payload.rol,
        nombre: payload.email ? payload.email.split('@')[0] : 'Usuario',
        tenantId: payload.tenantId,
        originalTenantId: payload.tenantId,
        isAllSucursales: req?.headers?.['x-sucursal-id'] === 'TODAS',
        permiteCambiarPrecio: false,
      };
    }

    if (!user || !user.activo) {
      throw new UnauthorizedException('Usuario no encontrado o desactivado');
    }

    // Validar unicidad de sesión: primero en memoria, luego en base de datos como respaldo persistente
    const inMemorySession = ActiveSessionStore.get(user.id);
    const activeSessionId = inMemorySession || user.activeSessionId;
    if (payload.sessionId && activeSessionId && activeSessionId !== payload.sessionId) {
      throw new UnauthorizedException('Tu sesión ha expirado o se ha iniciado sesión en otro dispositivo.');
    }
    // Sincronizar el store en memoria si estaba vacío pero la BD tiene una sesión activa
    if (!inMemorySession && user.activeSessionId) {
      ActiveSessionStore.set(user.id, user.activeSessionId);
    } else {
      // Registrar latido de actividad reciente
      ActiveSessionStore.touch(user.id, payload.sessionId || user.activeSessionId);
    }

    const canSwitchSucursal = user.rol === 'ROL_SUPER_ADMIN' || user.rol === 'ROL_ADMIN' || user.rol === 'ROL_VENDEDOR';
    const isGlobalAdmin = user.rol === 'ROL_SUPER_ADMIN' || (user.rol === 'ROL_ADMIN' && user.esAdminGeneral === true);
    const isAllSucursales = canSwitchSucursal && req?.headers?.['x-sucursal-id'] === 'TODAS';
    const targetSucursalId = req?.headers?.['x-sucursal-id'];
    let activeTenantId = isAllSucursales ? null : user.tenantId;

    if (
      targetSucursalId &&
      targetSucursalId !== 'TODAS' &&
      canSwitchSucursal
    ) {
      if (user.tenantId && targetSucursalId === user.tenantId) {
        activeTenantId = targetSucursalId;
      } else {
        const targetTenant = await this.prisma.tenant.findUnique({
          where: { id: targetSucursalId, active: true },
        });
        if (targetTenant) {
          activeTenantId = targetSucursalId;
        }
      }
    }

    return {
      id: user.id,
      sub: user.id,
      email: user.email,
      rol: user.rol,
      esAdminGeneral: isGlobalAdmin,
      nombre: user.nombre,
      tenantId: activeTenantId,
      originalTenantId: user.tenantId,
      isAllSucursales,
      permiteCambiarPrecio: user.permiteCambiarPrecio,
    };
  }
}
