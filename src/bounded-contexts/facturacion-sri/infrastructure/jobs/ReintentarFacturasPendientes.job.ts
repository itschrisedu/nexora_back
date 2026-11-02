import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

/**
 * ReintentarFacturasPendientes — Cron Job.
 *
 * Se ejecuta cada 15 minutos y busca facturas electrónicas con estado
 * PENDIENTE o RECHAZADO (emitidas en las últimas 72 horas) que tengan
 * claveAcceso asignada. Para cada una consulta al SRI si ya fue
 * autorizada y actualiza el estado en la base de datos.
 *
 * Esto cubre el escenario donde el SRI estaba congestionado al momento
 * de la emisión: la factura se registró como PENDIENTE/RECHAZADO pero
 * el SRI pudo haberla procesado después.
 *
 * Se agrega un delay de 2 segundos entre cada consulta para no saturar
 * los servidores del SRI y evitar bloqueos de IP.
 */
@Injectable()
export class ReintentarFacturasPendientes {
  private readonly logger = new Logger(ReintentarFacturasPendientes.name);
  private readonly sriBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const rawUrl = this.configService.get<string>(
      'SRI_MICROSERVICE_URL',
      'http://localhost:4000',
    );
    let url = (rawUrl || 'http://localhost:4000').trim().replace(/\/+$/, '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    this.sriBaseUrl = url;
  }

  @Cron('*/15 * * * *') // Cada 15 minutos
  async handleCron() {
    // Calcular fecha límite: solo facturas de las últimas 72 horas
    const hace72h = new Date();
    hace72h.setHours(hace72h.getHours() - 72);

    // Buscar facturas pendientes o rechazadas que tengan claveAcceso
    const facturasPendientes = await this.prisma.facturaElectronica.findMany({
      where: {
        estadoSri: { in: ['PENDIENTE', 'RECHAZADO'] },
        claveAcceso: { not: null },
        createdAt: { gte: hace72h },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (facturasPendientes.length === 0) return;

    this.logger.log(
      `Encontradas ${facturasPendientes.length} factura(s) pendiente(s) de autorización. Consultando SRI...`,
    );

    let autorizadas = 0;
    let errores = 0;

    for (const factura of facturasPendientes) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(
            `${this.sriBaseUrl}/sri/comprobante/${factura.claveAcceso}`,
            { timeout: 30000 },
          ),
        );

        if (response.data?.estado === 'AUTORIZADO') {
          await this.prisma.facturaElectronica.update({
            where: { id: factura.id },
            data: {
              estadoSri: 'AUTORIZADO',
              errorMensaje: null,
            },
          });
          autorizadas++;
          this.logger.log(
            `  Factura ${factura.numeroComprobante} (${factura.claveAcceso}) -> AUTORIZADO`,
          );
        } else {
          this.logger.log(
            `  Factura ${factura.numeroComprobante} sigue pendiente en SRI`,
          );
        }
      } catch (error: any) {
        errores++;
        this.logger.warn(
          `  No se pudo consultar factura ${factura.numeroComprobante}: ${error.message}`,
        );
      }

      // Delay de 2 segundos entre consultas para no saturar el SRI
      await this.sleep(2000);
    }

    this.logger.log(
      `Reintento finalizado: ${autorizadas} autorizada(s), ${errores} error(es), ${facturasPendientes.length - autorizadas - errores} sin cambio`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

