import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';

@Injectable()
export class AutoDespachoOrdenesService {
  private readonly logger = new Logger(AutoDespachoOrdenesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cron Job ejecutado cada minuto para verificar el despacho automático
   * de órdenes de compra a proveedores (por defecto 08:00 AM hora de Ecuador).
   * 
   * REGLAS DE NEGOCIO:
   * 1. EXCEPTO SÁBADOS Y DOMINGOS: Fines de semana no se envía nada automático.
   * 2. ZONA HORARIA: Se calcula estrictamente en hora local ecuatoriana (America/Guayaquil, UTC-5).
   * 3. MULTI-TENANT: Cada negocio evalúa su propia configuración y envía únicamente sus órdenes.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async verificarYDespacharOrdenesProgramadas() {
    try {
      // Obtener fecha y hora en zona horaria de Ecuador
      const nowEcuador = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guayaquil' }));
      const diaSemana = nowEcuador.getDay(); // 0 = Domingo, 1 = Lunes, ..., 5 = Viernes, 6 = Sábado
      const horas = String(nowEcuador.getHours()).padStart(2, '0');
      const minutos = String(nowEcuador.getMinutes()).padStart(2, '0');
      const horaActual = `${horas}:${minutos}`;

      // REGLA: Fines de semana (Sábado = 6, Domingo = 0) no se realiza envío automático
      if (diaSemana === 0 || diaSemana === 6) {
        return;
      }

      // Obtener todos los negocios activos con su configuración individual
      const tenants = await this.prisma.tenant.findMany({
        where: { active: true },
        include: { businessConfig: true },
      });

      for (const tenant of tenants) {
        const config = tenant.businessConfig;
        const autoDespachoActivo = config ? (config.autoDespachoHabilitado ?? true) : true;

        if (!autoDespachoActivo) {
          continue; // El negocio tiene desactivado el auto-despacho
        }

        const horaConfigurada = config?.horaInicioOperativa || '08:00';

        // Si coincide la hora exacta del minuto actual con la hora configurada (08:00 AM)
        if (horaActual === horaConfigurada) {
          await this.ejecutarDespachoPorTenant(tenant.id, tenant.name);
        }
      }
    } catch (e: any) {
      this.logger.error(`Error en cron de verificación de auto-despacho: ${e.message}`);
    }
  }

  /**
   * Transiciona todas las órdenes de compra acumuladas en BORRADOR a PENDIENTE (Enviada a Taller/Proveedor)
   * para un negocio específico (Multi-Tenant).
   */
  async ejecutarDespachoPorTenant(tenantId: string, tenantName?: string): Promise<{ despachadas: number }> {
    this.logger.log(`Iniciando auto-despacho programado de órdenes para el negocio: ${tenantName || tenantId}...`);

    const borradoresConLineas = await this.prisma.supplierOrder.findMany({
      where: {
        estado: 'BORRADOR',
        supplier: {
          tenantId: tenantId,
        },
        lines: {
          some: {},
        },
      },
      include: {
        lines: true,
        supplier: true,
      },
    });

    if (borradoresConLineas.length === 0) {
      this.logger.log(`Negocio ${tenantName || tenantId}: No hay órdenes borrador pendientes el día de hoy.`);
      return { despachadas: 0 };
    }

    let contador = 0;
    for (const orden of borradoresConLineas) {
      await this.prisma.supplierOrder.update({
        where: { id: orden.id },
        data: {
          estado: 'PENDIENTE',
          updatedAt: new Date(),
        },
      });
      contador++;
      this.logger.log(
        `[${tenantName || tenantId}] Orden OC-${String(orden.numero).padStart(4, '0')} para ${orden.supplier?.razonSocial || 'Proveedor'} enviada automáticamente. Total: $${Number(orden.total).toFixed(2)}`,
      );
    }

    // Registrar en auditoría del negocio
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: tenantId,
          accion: 'ACTUALIZAR',
          entidad: 'SupplierOrder',
          userEmail: 'SISTEMA_AUTO_DESPACHO_8AM',
          userRol: 'SISTEMA',
          detalles: {
            motivo: 'Auto-despacho programado a las 08:00 AM (Lunes a Viernes)',
            totalOrdenes: contador,
            ordenesIds: borradoresConLineas.map((o) => o.id),
          },
        },
      });
    } catch (auditErr) {
      this.logger.warn(`No se pudo registrar log de auditoría para auto-despacho: ${auditErr}`);
    }

    this.logger.log(`Auto-despacho finalizado con éxito para ${tenantName || tenantId}: ${contador} órdenes enviadas.`);
    return { despachadas: contador };
  }

  /**
   * Ejecución global para todos los tenants (útil para pruebas o llamada manual global)
   */
  async ejecutarDespachoAutomatico(): Promise<{ despachadas: number }> {
    const tenants = await this.prisma.tenant.findMany({ where: { active: true } });
    let total = 0;
    for (const t of tenants) {
      const res = await this.ejecutarDespachoPorTenant(t.id, t.name);
      total += res.despachadas;
    }
    return { despachadas: total };
  }
}
