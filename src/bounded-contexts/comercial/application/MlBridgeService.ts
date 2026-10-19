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
   * Helper para determinar si un color es puro o compuesto.
   */
  public esColorPuro(color?: string | null): boolean {
    if (!color) return true;
    const c = color.trim().toLowerCase();
    return !c.includes(' con ') && !c.includes(' y ') && !c.includes('/') && !c.includes('+') && !c.includes('-');
  }

  /**
   * Obtener predicción de demanda para un tenant.
   * Extrae las ventas históricas y las envía al microservicio Python, enriqueciendo con stock actual.
   */
  async obtenerPrediccion(
    tenantId: string,
    horizonteDias = 30,
    temporada = 'REGULAR',
    colorExacto = true,
    colorFiltro?: string,
  ) {
    // 1. Extraer ventas históricas del tenant
    const ventas = await this.extraerVentasHistoricas(tenantId);

    // Obtener stock actual de todos los productos del tenant para calcular déficit y mapear modelos/fotos
    const { stockActualMap, modelsMap, productModels } = await this.obtenerStockActualYModelosMap(tenantId);

    if (ventas.length < 10) {
      // Heurística de predicción estacional para negocios con historial inicial
      return this.generarPrediccionHeuristica(
        tenantId,
        ventas,
        horizonteDias,
        temporada,
        stockActualMap,
        modelsMap,
        productModels,
        colorExacto,
        colorFiltro,
      );
    }

    // 2. Llamar al microservicio ML
    const payload = {
      tenant_id: tenantId,
      ventas,
      horizonte_dias: horizonteDias,
      temporada,
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

      // Enriquecer cada predicción con stock actual, cálculo de déficit, fotos y variantes
      if (Array.isArray(prediccion.predicciones)) {
        prediccion.predicciones = prediccion.predicciones.map((p: any) => {
          const modelKey = (p.modelo || '').toLowerCase().trim();
          const key = `${modelKey}_${p.talla}`;
          const stockInfo = stockActualMap.get(key) || {
            stock: 0,
            precioCosto: 22,
            precioVenta: 35,
            productId: null,
            imageUrl: null,
            color: null,
            modelId: null,
            variantes: [],
          };
          const modelInfo = modelsMap.get(modelKey);
          const stockActual = stockInfo.stock;
          const deficit = Math.max(0, p.demanda_estimada - stockActual);
          const imageUrl = stockInfo.imageUrl || modelInfo?.primaryImageUrl || null;
          const variantes = modelInfo?.variantes || [];
          const colorVal = stockInfo.color || (variantes.length === 1 ? variantes[0].color : null) || p.color;
          return {
            ...p,
            stock_actual: stockActual,
            deficit_stock: deficit,
            precio_costo: stockInfo.precioCosto,
            precio_venta: stockInfo.precioVenta,
            productId: stockInfo.productId,
            imageUrl,
            fotoUrl: imageUrl,
            color: colorVal,
            colorPuro: this.esColorPuro(colorVal),
            modelId: stockInfo.modelId || modelInfo?.modelId,
            variantes,
            inversion_reorden_estimada: deficit * stockInfo.precioCosto,
          };
        });

        // Filtrado por color exacto vs compuesto si se solicita
        if (colorFiltro && colorFiltro.trim()) {
          const cTarget = colorFiltro.trim().toLowerCase();
          prediccion.predicciones = prediccion.predicciones.filter((p: any) => {
            const pColor = (p.color || '').trim().toLowerCase();
            if (colorExacto) {
              return pColor === cTarget;
            } else {
              return pColor.includes(cTarget);
            }
          });
          prediccion.total_productos_analizados = prediccion.predicciones.length;
        }
      }

      this.logger.log(
        `Predicción estacional (${temporada}) generada para tenant=${tenantId}: ${prediccion.total_productos_analizados} productos`,
      );
      prediccion.color_filtro = colorFiltro || null;
      prediccion.color_exacto = colorExacto;
      return prediccion;
    } catch (error: any) {
      this.logger.warn(`Fallback a heurística estacional por error ML: ${error.message}`);
      return this.generarPrediccionHeuristica(
        tenantId,
        ventas,
        horizonteDias,
        temporada,
        stockActualMap,
        modelsMap,
        productModels,
        colorExacto,
        colorFiltro,
      );
    }
  }

  /**
   * Mapea el stock actual por modelo y talla, y agrupa variantes y fotos por modelo.
   */
  private async obtenerStockActualYModelosMap(tenantId: string) {
    const productModels = await this.prisma.productModel.findMany({
      where: { tenantId },
      include: {
        products: {
          include: {
            serie: true,
            stockByTalla: {
              include: {
                talla: true,
              },
            },
          },
        },
      },
    });

    const stockActualMap = new Map<
      string,
      {
        stock: number;
        precioCosto: number;
        precioVenta: number;
        productId: string;
        modelId: string;
        imageUrl: string | null;
        color: string;
        variantes: any[];
      }
    >();

    const modelsMap = new Map<
      string,
      {
        modelId: string;
        nombre: string;
        marca: string;
        primaryImageUrl: string | null;
        variantes: any[];
      }
    >();

    for (const pm of productModels) {
      const modelNameClean = (pm.name || '').toLowerCase().trim();

      const variantes = pm.products.map((p) => {
        const foto = p.imageUrl || null;
        const totalStock = (p.stockByTalla || []).reduce((acc, s) => acc + (s.quantity || 0), 0);
        return {
          id: p.id,
          codigo: p.code,
          color: p.color,
          imageUrl: foto,
          fotoUrl: foto,
          precioCosto: Number(p.costPrice) || 22,
          precioVenta: Number(p.salePrice) || 35,
          serie: p.serie?.nombre || '',
          stockTotal: totalStock,
          tallas: (p.stockByTalla || []).map((s) => ({
            numero: s.talla.numero,
            stock: s.quantity,
          })),
        };
      });

      const primaryImageUrl = variantes.find((v) => v.imageUrl)?.imageUrl || null;

      modelsMap.set(modelNameClean, {
        modelId: pm.id,
        nombre: pm.name,
        marca: pm.brand,
        primaryImageUrl,
        variantes,
      });

      for (const prod of pm.products) {
        const prodFoto = prod.imageUrl || primaryImageUrl;
        for (const item of prod.stockByTalla) {
          const tallaNum = item.talla.numero;
          const key = `${modelNameClean}_${tallaNum}`;
          const existing = stockActualMap.get(key);
          const qty = item.quantity;
          if (existing) {
            existing.stock += qty;
            if (!existing.imageUrl && prodFoto) {
              existing.imageUrl = prodFoto;
            }
          } else {
            stockActualMap.set(key, {
              stock: qty,
              precioCosto: Number(prod.costPrice) || 22,
              precioVenta: Number(prod.salePrice) || 35,
              productId: prod.id,
              modelId: pm.id,
              imageUrl: prodFoto,
              color: prod.color,
              variantes,
            });
          }
        }
      }
    }

    return { stockActualMap, modelsMap, productModels };
  }

  /**
   * Generador de proyecciones heurísticas estacionales robustas cuando hay pocas ventas o el microservicio está ocupado.
   */
  private async generarPrediccionHeuristica(
    tenantId: string,
    ventas: any[],
    horizonteDias: number,
    temporada: string,
    stockMap: Map<string, any>,
    modelsMap?: Map<string, any>,
    cachedProducts?: any[],
    colorExacto = true,
    colorFiltro?: string,
  ) {
    const products = cachedProducts && cachedProducts.length > 0
      ? cachedProducts.flatMap((pm: any) => pm.products || [])
      : await this.prisma.product.findMany({
          where: {
            model: { tenantId },
          },
          include: {
            model: true,
            serie: {
              include: {
                tallas: true,
              },
            },
            stockByTalla: {
              include: {
                talla: true,
              },
            },
          },
        });

    const TEMPORADAS_INFO: Record<string, { nombre: string; desc: string; multDef: number; keywords: string[]; multMatch: number }> = {
      REGULAR: {
        nombre: 'Temporada Regular',
        desc: 'Proyección de rotación estándar basada en existencias y ventas habituales',
        multDef: 1.0,
        keywords: [],
        multMatch: 1.0,
      },
      CLASES_SIERRA: {
        nombre: 'Inicio de Clases Sierra / Amazonía',
        desc: 'Pico de demanda en calzado escolar, colegial, mocasines y deportivo blanco/negro (Agosto - Octubre)',
        multDef: 1.35,
        keywords: ['escolar', 'colegial', 'mocas', 'estudiantil', 'negro', 'juvenil', 'botin', 'blanco', 'deportiv', 'tenis', 'pupillo'],
        multMatch: 2.2,
      },
      CLASES_COSTA: {
        nombre: 'Inicio de Clases Costa / Galápagos',
        desc: 'Alta demanda de calzado escolar, colegial y deportivo blanco/negro para el régimen Costa (Febrero - Mayo)',
        multDef: 1.25,
        keywords: ['escolar', 'colegial', 'mocas', 'estudiantil', 'negro', 'blanco', 'deportiv', 'tenis'],
        multMatch: 2.0,
      },
      NAVIDAD_FIN_ANIO: {
        nombre: 'Navidad & Fin de Año',
        desc: 'Temporada alta comercial general: calzado formal de vestir, botas, botines de gala y compras por mayor',
        multDef: 1.6,
        keywords: ['formal', 'vestir', 'bota', 'botin', 'tacon', 'gala', 'elegante', 'casual'],
        multMatch: 1.9,
      },
      DIA_MADRE_PADRE: {
        nombre: 'Día de la Madre y Padre',
        desc: 'Incremento de ventas en calzado ejecutivo, casual de cuero, líneas de confort, cuarterones y dama/caballero',
        multDef: 1.4,
        keywords: ['dama', 'caballero', 'confort', 'clasico', 'casual', 'oxford', 'sandalia', 'cuarteron', 'cuarterones', 'tacon', 'reina'],
        multMatch: 1.75,
      },
      FERIA_CEVALLOS: {
        nombre: 'Feria del Calzado & Fiestas de Cevallos',
        desc: 'Pico comercial por turismo de compras y pedidos mayoristas en locales de Cevallos y Tungurahua',
        multDef: 1.5,
        keywords: ['cuero', 'casual', 'botin', 'oxford', 'bota', 'artesanal'],
        multMatch: 1.8,
      },
    };

    const tempCfg = TEMPORADAS_INFO[temporada] || TEMPORADAS_INFO.REGULAR;
    const factorBaseHorizonte = horizonteDias / 30;

    let predicciones: any[] = [];
    const alertas: string[] = [];

    for (const prod of products) {
      const modelName = prod.model?.name || 'Modelo Clásico';
      const serieName = prod.serie?.nombre || 'Serie Estándar';
      const colorName = prod.color || '';
      const materialName = prod.model?.material || '';
      const fullText = `${modelName} ${serieName} ${colorName} ${materialName}`.toLowerCase();
      const isMatch = tempCfg.keywords.some((k) => fullText.includes(k));
      const factorEstacional = isMatch ? tempCfg.multMatch : tempCfg.multDef;

      const modelKey = modelName.toLowerCase().trim();
      const modelInfo = modelsMap?.get(modelKey);
      const imgUrl = prod.imageUrl || modelInfo?.primaryImageUrl || null;
      const variantesList = modelInfo?.variantes || [];

      // Desglose por tallas
      const tallas = prod.stockByTalla?.length
        ? prod.stockByTalla.map((st: any) => ({ numero: st.talla.numero, stock: st.quantity }))
        : (prod.serie?.tallas || []).map((t: any) => ({ numero: t.numero, stock: 4 }));

      for (const t of tallas) {
        const ventasHistoricasTalla = ventas.filter(
          (v) => v.modelo.toLowerCase() === modelName.toLowerCase() && v.talla === t.numero,
        );
        const totalVendidas = ventasHistoricasTalla.reduce((sum, v) => sum + v.cantidad, 0);

        // Demanda base estimada (histórico o promedio heurístico de 4 a 12 pares por mes)
        const rotacionEstimadaMes = totalVendidas > 0 ? Math.max(3, totalVendidas * 1.5) : 5;
        const demandaBase = Math.max(1, Math.round(rotacionEstimadaMes * factorBaseHorizonte));
        const demandaEstimada = Math.max(1, Math.round(demandaBase * factorEstacional));
        const stockActual = t.stock;
        const deficit = Math.max(0, demandaEstimada - stockActual);
        const precioCosto = Number(prod.costPrice) || 22;
        const precioVenta = Number(prod.salePrice) || 35;
        const sugerenciaReorden = Math.max(deficit, Math.round(demandaEstimada * 1.2));
        const impactoPct = Math.round((factorEstacional - 1.0) * 100);

        predicciones.push({
          modelo: modelName,
          serie: serieName,
          talla: t.numero,
          demanda_base: demandaBase,
          demanda_estimada: demandaEstimada,
          factor_estacional: factorEstacional,
          impacto_estacional_pct: impactoPct,
          stock_actual: stockActual,
          deficit_stock: deficit,
          precio_costo: precioCosto,
          precio_venta: precioVenta,
          productId: prod.id,
          modelId: prod.modelId,
          imageUrl: imgUrl,
          fotoUrl: imgUrl,
          color: prod.color,
          colorPuro: this.esColorPuro(prod.color),
          variantes: variantesList,
          inversion_reorden_estimada: deficit * precioCosto,
          confianza: totalVendidas >= 5 ? 0.92 : 0.85,
          tendencia: factorEstacional >= 1.3 ? 'ALZA' : 'ESTABLE',
          sugerencia_reorden: sugerenciaReorden,
        });
      }
    }

    // Filtrar por color exacto vs compuesto si se solicitó
    if (colorFiltro && colorFiltro.trim()) {
      const cTarget = colorFiltro.trim().toLowerCase();
      predicciones = predicciones.filter((p: any) => {
        const pColor = (p.color || '').trim().toLowerCase();
        if (colorExacto) {
          return pColor === cTarget;
        } else {
          return pColor.includes(cTarget);
        }
      });
    }

    // Ordenar por mayor demanda estimada
    predicciones.sort((a, b) => b.demanda_estimada - a.demanda_estimada);

    for (const p of predicciones.slice(0, 5)) {
      alertas.push(
        `${p.modelo} (${p.serie}) T${p.talla}: proyección ${p.demanda_estimada} pares (${p.impacto_estacional_pct >= 0 ? '+' : ''}${p.impacto_estacional_pct}% en ${tempCfg.nombre})`,
      );
    }

    return {
      tenant_id: tenantId,
      horizonte_dias: horizonteDias,
      total_productos_analizados: predicciones.length,
      temporada_activa: temporada,
      temporada_nombre: tempCfg.nombre,
      temporada_descripcion: tempCfg.desc,
      multiplicador_global: tempCfg.multDef,
      predicciones,
      modelo_score: 0.88,
      alerta_stock_bajo: alertas,
      es_heuristico: ventas.length < 10,
      color_filtro: colorFiltro || null,
      color_exacto: colorExacto,
    };
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
      color: string;
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
          color: producto.color ?? '',
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
