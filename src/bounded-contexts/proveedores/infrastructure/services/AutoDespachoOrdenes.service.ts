import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';

@Injectable()
export class AutoDespachoOrdenesService {
  private readonly logger = new Logger(AutoDespachoOrdenesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cron Job ejecutado cada minuto para verificar si coincide con la hora
   * programada de despacho automático de órdenes de compra a proveedores (por defecto 08:00 AM).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async verificarYDespacharOrdenesProgramadas() {
    try {
      const now = new Date();
      // Formato HH:mm en zona horaria local ecuatoriana
      const horas = String(now.getHours()).padStart(2, '0');
      const minutos = String(now.getMinutes()).padStart(2, '0');
      const horaActual = `${horas}:${minutos}`;

      // Obtener configuraciones de negocio registradas
      const configs = await this.prisma.businessConfig.findMany();
      const horaConfigurada = configs.length > 0 && configs[0].horaInicioOperativa
        ? configs[0].horaInicioOperativa
        : '08:00';

      if (horaActual === horaConfigurada) {
        await this.ejecutarDespachoAutomatico();
      }
    } catch (e: any) {
      this.logger.error(`Error en cron de verificación de auto-despacho: ${e.message}`);
    }
  }

  /**
   * Transiciona todas las órdenes de compra acumuladas en BORRADOR a PENDIENTE (Enviada)
   */
  async ejecutarDespachoAutomatico(): Promise<{ despachadas: number }> {
    this.logger.log('Iniciando auto-despacho programado de órdenes de compra a proveedores...');

    const borradoresConLineas = await this.prisma.supplierOrder.findMany({
      where: {
        estado: 'BORRADOR',
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
      this.logger.log('No hay órdenes borrador pendientes de despacho el día de hoy.');
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
        `Orden OC-${String(orden.numero).padStart(4, '0')} para el proveedor ${orden.supplier?.razonSocial || 'Proveedor'} enviada automáticamente. Total: $${Number(orden.total).toFixed(2)}`,
      );
    }

    this.logger.log(`Auto-despacho finalizado con éxito: ${contador} órdenes enviadas a proveedores.`);
    return { despachadas: contador };
  }
}
