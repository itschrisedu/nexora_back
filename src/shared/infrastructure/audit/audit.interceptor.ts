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
    const userAgent = req.headers['user-agent'] || 'Navegador Web';
    const bodySaneado = this.sanearBody(req.body);

    return next.handle().pipe(
      tap((resData) => {
        const resumenHumano = this.generarDescripcionHumana(
          method,
          entidad,
          bodySaneado,
          req.originalUrl || '',
          resData,
        );

        this.auditService.registrar({
          tenantId: user.tenantId,
          userId: user.id || user.userId || user.sub,
          userEmail: user.email || user.username || 'Usuario',
          userRol: user.rol || user.role || 'USUARIO',
          accion,
          entidad,
          entidadId: resData?.id || req.params?.id,
          detalles: {
            resumenHumano,
            url: req.originalUrl,
            params: req.params,
            query: req.query,
            body: bodySaneado,
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
    if (copia.password) copia.password = '***';
    if (copia.passwordHash) copia.passwordHash = '***';
    return copia;
  }

  /**
   * Genera un resumen en lenguaje natural entendible para el administrador del local.
   */
  private generarDescripcionHumana(
    method: string,
    entidad: string,
    body: any,
    url: string,
    resData: any,
  ): string {
    const ruta = url.toLowerCase();

    // 1. Cobros & Abonos
    if (entidad === 'COBRO' || ruta.includes('/abono') || ruta.includes('/cobro')) {
      const monto = body?.monto ? `$${Number(body.monto).toFixed(2)}` : '';
      const metodo = body?.metodo ? ` mediante ${body.metodo}` : '';
      const notas = body?.notas ? ` (${body.notas})` : '';
      return `Cobro/Abono registrado por ${monto || 'monto recibido'}${metodo}${notas}`;
    }

    // 2. Ventas & Notas de Venta
    if (entidad === 'VENTA' || ruta.includes('/nota-venta') || ruta.includes('/sale-note') || ruta.includes('/venta')) {
      const total = body?.total ? `$${Number(body.total).toFixed(2)}` : (resData?.total ? `$${Number(resData.total).toFixed(2)}` : '');
      const cliente = body?.clienteNombre || body?.clientName || '';
      return `Registro de venta${total ? ' por ' + total : ''}${cliente ? ' a cliente ' + cliente : ''}`;
    }

    // 3. Pedidos Comerciales
    if (entidad === 'PEDIDO' || ruta.includes('/order') || ruta.includes('/pedido')) {
      const pares = body?.lines?.length || (Array.isArray(body?.items) ? body.items.length : '');
      const total = body?.total ? ` por $${Number(body.total).toFixed(2)}` : '';
      return `${method === 'POST' ? 'Creación de pedido comercial' : 'Actualización de pedido'}${pares ? ' (' + pares + ' modelos/pares)' : ''}${total}`;
    }

    // 4. Despachos
    if (entidad === 'DESPACHO' || ruta.includes('/despacho') || ruta.includes('/dispatch')) {
      return `Despacho de pedido de calzado a proveedor / taller`;
    }

    // 5. Clientes
    if (entidad === 'CLIENTE' || ruta.includes('/cliente')) {
      const nombre = [body?.nombres || body?.nombre, body?.apellidos || body?.apellido].filter(Boolean).join(' ');
      const cedula = body?.cedula ? ` (CI: ${body.cedula})` : '';
      return `${method === 'POST' ? 'Nuevo cliente registrado' : 'Datos de cliente actualizados'}: ${nombre || 'Cliente'}${cedula}`;
    }

    // 6. Inventario / Productos
    if (entidad === 'INVENTARIO' || ruta.includes('/product') || ruta.includes('/inventario')) {
      const modelo = body?.modelName || body?.nombre || body?.name || body?.code || '';
      const precio = body?.salePrice ? ` ($${Number(body.salePrice).toFixed(2)})` : '';
      return `${method === 'POST' ? 'Nuevo producto creado' : 'Inventario actualizado'}: ${modelo || 'Calzado'}${precio}`;
    }

    // 7. Proveedores
    if (entidad === 'PROVEEDOR' || ruta.includes('/proveedor') || ruta.includes('/supplier')) {
      const nombre = body?.nombre || body?.name || '';
      return `${method === 'POST' ? 'Nuevo taller/proveedor registrado' : 'Proveedor actualizado'}: ${nombre || 'Proveedor'}`;
    }

    // 8. Cierre de Caja
    if (entidad === 'CIERRE_CAJA' || ruta.includes('/caja')) {
      return `Cierre de caja y arqueo diario`;
    }

    // 9. Autenticación
    if (entidad === 'AUTH' || ruta.includes('/login')) {
      return `Inicio de sesión de usuario en el sistema`;
    }

    // 10. Fallback amigable
    const accionTexto = method === 'POST' ? 'Registro en' : method === 'DELETE' ? 'Eliminación en' : 'Modificación en';
    return `${accionTexto} el módulo de ${entidad.toLowerCase()}`;
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
    return url.split('?')[0] || 'GENERAL';
  }
}
