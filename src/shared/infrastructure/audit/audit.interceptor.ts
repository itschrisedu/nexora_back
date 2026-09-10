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

    const entidad = auditMeta?.entidad ?? this.inferirEntidad(req.originalUrl || req.route?.path || '');
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

  /**
   * Inferir entidad estandarizada a partir de la URL de la petición.
   */
  private inferirEntidad(url: string): string {
    const ruta = url.toLowerCase();
    if (ruta.includes('/cobro') || ruta.includes('/abono')) return 'COBRO';
    if (ruta.includes('/nota-venta') || ruta.includes('/sale-note') || ruta.includes('/venta')) return 'VENTA';
    if (ruta.includes('/pedido') || ruta.includes('/order') || ruta.includes('/comercial')) return 'PEDIDO';
    if (ruta.includes('/dispatch') || ruta.includes('/despacho')) return 'DESPACHO';
    if (ruta.includes('/cliente') || ruta.includes('/client')) return 'CLIENTE';
    if (ruta.includes('/producto') || ruta.includes('/product') || ruta.includes('/inventario')) return 'INVENTARIO';
    if (ruta.includes('/proveedor') || ruta.includes('/supplier')) return 'PROVEEDOR';
    if (ruta.includes('/cierre-caja') || ruta.includes('/caja')) return 'CIERRE_CAJA';
    if (ruta.includes('/auth') || ruta.includes('/login')) return 'AUTH';
    if (ruta.includes('/gasto')) return 'GASTO';
    if (ruta.includes('/campana') || ruta.includes('/promo')) return 'PROMOCION';
    return url.split('?')[0] || 'DESCONOCIDO';
  }
}
