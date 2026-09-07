import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
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
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        rol: true,
        activo: true,
        nombre: true,
        tenantId: true,
        permiteCambiarPrecio: true,
      },
    });

    if (!user || !user.activo) {
      throw new UnauthorizedException('Usuario no encontrado o desactivado');
    }

    const currentActiveSession = ActiveSessionStore.get(user.id);
    if (payload.sessionId && currentActiveSession && currentActiveSession !== payload.sessionId) {
      throw new UnauthorizedException('Tu sesión ha expirado o se ha iniciado sesión en otro dispositivo.');
    }

    let activeTenantId = user.tenantId;
    const isAllSucursales = req?.headers?.['x-sucursal-id'] === 'TODAS';
    const targetSucursalId = req?.headers?.['x-sucursal-id'];

    if (
      targetSucursalId &&
      targetSucursalId !== 'TODAS' &&
      (user.rol === 'ROL_ADMIN' || user.rol === 'ROL_SUPER_ADMIN')
    ) {
      if (user.tenantId) {
        const userConfig = await this.prisma.businessConfig.findUnique({
          where: { tenantId: user.tenantId },
          select: { ruc: true },
        });

        if (userConfig?.ruc) {
          const sucursalValida = await this.prisma.businessConfig.findFirst({
            where: {
              tenantId: targetSucursalId,
              ruc: userConfig.ruc,
            },
          });
          if (sucursalValida) {
            activeTenantId = targetSucursalId;
          }
        }
      } else if (user.rol === 'ROL_SUPER_ADMIN') {
        activeTenantId = targetSucursalId;
      }
    }

    return {
      id: user.id,
      sub: user.id,
      email: user.email,
      rol: user.rol,
      nombre: user.nombre,
      tenantId: activeTenantId,
      originalTenantId: user.tenantId,
      isAllSucursales,
      permiteCambiarPrecio: user.permiteCambiarPrecio,
    };
  }
}
