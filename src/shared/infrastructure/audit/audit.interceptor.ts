import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AUDIT_KEY, AuditOptions } from './audit.decorator';
import { AccionAuditoria } from '@prisma/client';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;

    // Solo auditar si hay usuario autenticado (tenantId disponible)
    const user = req.user;
    if (!user || !user.tenantId) {
      return next.handle();
    }

    const auditMeta = this.reflector.get<AuditOptions>(
      AUDIT_KEY,
      context.getHandler(),
    );

    // Auditar automáticamente escrituras (POST, PUT, PATCH, DELETE) o metadatos explícitos
    const esEscritura = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (!esEscritura && !auditMeta) {
      return next.handle();
    }

    let accion: AccionAuditoria = AccionAuditoria.ACTUALIZAR;
    if (method === 'POST') accion = AccionAuditoria.CREAR;
    if (method === 'DELETE') accion = AccionAuditoria.ELIMINAR;
    if (auditMeta?.accion) accion = auditMeta.accion;

    const entidad = auditMeta?.entidad ?? req.route?.path ?? 'DESCONOCIDO';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Desconocido';

    return next.handle().pipe(
      tap((resData) => {
        this.auditService.registrar({
          tenantId: user.tenantId,
          userId: user.id || user.userId,
          userEmail: user.email,
          userRol: user.rol,
          accion,
          entidad,
          entidadId: resData?.id,
          detalles: {
            url: req.originalUrl,
            params: req.params,
            query: req.query,
            body: this.sanearBody(req.body),
          },
          ipAddress: String(ipAddress),
          userAgent: String(userAgent),
        });
      }),
    );
  }

  private sanearBody(body: any) {
    if (!body) return undefined;
    const copia = { ...body };
    // Ocultar contraseñas en logs
    if (copia.password) copia.password = '***';
    if (copia.passwordHash) copia.passwordHash = '***';
    return copia;
  }
}
