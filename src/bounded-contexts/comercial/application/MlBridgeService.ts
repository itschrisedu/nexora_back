import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';

/**
 * MlBridgeService — Puente entre NestJS y el microservicio
 * de predicción de demanda Python (FastAPI).
 *
 * 1. Extrae las ventas históricas de la BD.
 * 2. Envía el payload al microservicio ML.
 * 3. Retorna las predicciones al frontend.
 */
@Injectable()
export class MlBridgeService {
  private readonly logger = new Logger(MlBridgeService.name);
  private readonly ML_URL = process.env.ML_SERVICE_URL ?? 'http://127.0.0.1:8001';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtener predicción de demanda para un tenant.
   * Extrae las ventas históricas y las envía al microservicio Python.
   */
  async obtenerPrediccion(tenantId: string, horizonteDias = 30) {
    // 1. Extraer ventas históricas del tenant
    const ventas = await this.extraerVentasHistoricas(tenantId);

    if (ventas.length < 10) {
      return {
        success: false,
        error: 'Datos insuficientes',
        mensaje: `Aun no tienes suficientes ventas registradas para generar una prediccion. Se necesitan al menos 10 ventas entregadas y actualmente tienes ${ventas.length}. Sigue vendiendo y pronto podras usar esta funcion.`,
        registrosActuales: ventas.length,
      };
    }

    // 2. Llamar al microservicio ML
    const payload = {
      tenant_id: tenantId,
      ventas,
      horizonte_dias: horizonteDias,
    };

    try {
      const response = await fetch(`${this.ML_URL}/prediccion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`ML Service respondió ${response.status}: ${errorBody}`);
      }

      const prediccion = await response.json();
      this.logger.log(
        `Predicción generada para tenant=${tenantId}: ${prediccion.total_productos_analizados} productos`,
      );
      return prediccion;
    } catch (error: any) {
      this.logger.error(`Error al contactar ML Service: ${error.message}`);
      return {
        success: false,
        error: 'Servicio no disponible',
        mensaje: 'El sistema de inteligencia artificial no esta disponible en este momento. Por favor, intenta de nuevo en unos minutos.',
      };
    }
  }

  /**
   * Forzar re-entrenamiento del modelo para un tenant.
   */
  async forzarReentrenamiento(tenantId: string) {
    const ventas = await this.extraerVentasHistoricas(tenantId);

    if (ventas.length < 10) {
      return {
        success: false,
        error: 'Datos insuficientes',
        mensaje: `Aun no tienes suficientes ventas para reentrenar el modelo. Se necesitan al menos 10 ventas entregadas y actualmente tienes ${ventas.length}. Continua registrando ventas y pronto podras reentrenar.`,
        registrosActuales: ventas.length,
      };
    }

    try {
      const response = await fetch(`${this.ML_URL}/reentrenamiento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, ventas }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.warn(`ML Service respondió ${response.status}: ${errorBody}`);
        return {
          success: false,
          error: 'Error en reentrenamiento',
          mensaje: 'Hubo un problema al procesar los datos de ventas para reentrenar el modelo. Por favor, intenta de nuevo mas tarde.',
        };
      }

      const result = await response.json();
      this.logger.log(`Re-entrenamiento completado para tenant=${tenantId}`);
      return { success: true, ...result };
    } catch (error: any) {
      this.logger.error(`Error al contactar ML Service para reentrenamiento: ${error.message}`);
      return {
        success: false,
        error: 'Servicio no disponible',
        mensaje: 'El sistema de inteligencia artificial no esta disponible en este momento. Por favor, intenta de nuevo en unos minutos.',
      };
    }
  }

  /**
   * Consultar estado del modelo ML para un tenant.
   */
  async estadoModelo(tenantId: string) {
    try {
      const response = await fetch(`${this.ML_URL}/modelo/${tenantId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch {
      return {
        tenant_id: tenantId,
        modelo_entrenado: false,
        ml_service_disponible: false,
      };
    }
  }

  // ─── Extracción de Datos ────────────────────────────────

  /**
   * Extrae las ventas históricas normalizadas para el ML.
   * Junta OrderLine + Order + Product + ProductModel + SeriesConfig + TallaConfig.
   */
  private async extraerVentasHistoricas(tenantId: string) {
    const ordenes = await this.prisma.order.findMany({
      where: {
        tenantId,
        estado: 'ENTREGADO',
      },
      include: {
        lines: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Extraer IDs de productos, series y tallas para lookup
    const productIds = new Set<string>();
    const serieIds = new Set<string>();
    const tallaIds = new Set<string>();

    for (const order of ordenes) {
      for (const line of order.lines) {
        productIds.add(line.productId);
        serieIds.add(line.serieId);
        tallaIds.add(line.tallaId);
      }
    }

    // Buscar productos con sus modelos
    const productos = await this.prisma.product.findMany({
      where: { id: { in: [...productIds] } },
      include: { model: true },
    });
    const productoMap = new Map(productos.map((p: typeof productos[number]) => [p.id, p]));

    // Buscar series
    const series = await this.prisma.seriesConfig.findMany({
      where: { id: { in: [...serieIds] } },
    });
    const serieMap = new Map(series.map((s: typeof series[number]) => [s.id, s]));

    // Buscar tallas
    const tallas = await this.prisma.tallaConfig.findMany({
      where: { id: { in: [...tallaIds] } },
    });
    const tallaMap = new Map(tallas.map((t: typeof tallas[number]) => [t.id, t]));

    // Construir registros normalizados
    const ventas: Array<{
      fecha: string;
      modelo: string;
      serie: string;
      talla: number;
      cantidad: number;
      precio_unitario: number;
      canal: string;
    }> = [];

    for (const order of ordenes) {
      for (const line of order.lines) {
        const producto = productoMap.get(line.productId);
        const serie = serieMap.get(line.serieId);
        const talla = tallaMap.get(line.tallaId);

        if (!producto || !serie || !talla) continue;

        ventas.push({
          fecha: order.createdAt.toISOString().split('T')[0],
          modelo: producto.model?.name ?? 'Desconocido',
          serie: serie.nombre,
          talla: talla.numero,
          cantidad: line.cantidad,
          precio_unitario: Number(line.precioUnitario),
          canal: order.canal,
        });
      }
    }

    return ventas;
  }
}
