import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccionAuditoria } from '@prisma/client';

export interface CreateAuditDto {
  tenantId: string;
  userId?: string;
  userEmail?: string;
  userRol?: string;
  accion: AccionAuditoria;
  entidad: string;
  entidadId?: string;
  detalles?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export type AuditSegmento = 'COBROS' | 'VENTAS' | 'PEDIDOS' | 'TODOS';

export interface AuditFilterDto {
  tenantId?: string;
  tenantIds?: string[];
  userId?: string;
  accion?: AccionAuditoria;
  entidad?: string;
  segmento?: AuditSegmento;
  fechaInicio?: string;
  fechaFin?: string;
  page?: number;
  limit?: number;
}

// Patrones de entidad por segmento
const SEGMENTO_ENTIDADES: Record<string, string[]> = {
  COBROS: ['COBRO', 'ABONO', 'CREDITO', 'PAGO', 'cobro', 'abono'],
  VENTAS: ['VENTA', 'NOTA_VENTA', 'SALE_NOTE', 'POS', 'venta', 'nota-venta', 'sale-note'],
  PEDIDOS: ['PEDIDO', 'ORDER', 'DESPACHO', 'DISPATCH', 'pedido', 'order', 'despacho'],
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registrar evento en la bitácora de auditoría.
   */
  async registrar(dto: CreateAuditDto) {
    try {
      const log = await this.prisma.auditLog.create({
        data: {
          tenantId: dto.tenantId,
          userId: dto.userId,
          userEmail: dto.userEmail,
          userRol: dto.userRol,
          accion: dto.accion,
          entidad: dto.entidad,
          entidadId: dto.entidadId,
          detalles: dto.detalles ? JSON.parse(JSON.stringify(dto.detalles)) : undefined,
          ipAddress: dto.ipAddress,
          userAgent: dto.userAgent,
        },
      });
      return log;
    } catch (err: any) {
      this.logger.error(`Error al guardar AuditLog: ${err.message}`);
    }
  }

  /**
   * Construir condición OR para filtrar por segmento.
   */
  private buildSegmentoWhere(segmento: AuditSegmento) {
    if (segmento === 'TODOS' || !SEGMENTO_ENTIDADES[segmento]) return {};
    const patrones = SEGMENTO_ENTIDADES[segmento];
    return {
      OR: patrones.map((p) => ({
        entidad: { contains: p, mode: 'insensitive' as const },
      })),
    };
  }

  /**
   * Consultar bitácora de auditoría con filtros, segmentación y paginación.
   */
  async buscarLogs(filter: AuditFilterDto) {
    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.tenantIds && filter.tenantIds.length > 0) {
      where.tenantId = { in: filter.tenantIds };
    } else if (filter.tenantId) {
      where.tenantId = filter.tenantId;
    }

    if (filter.userId) where.userId = filter.userId;
    if (filter.accion) where.accion = filter.accion;
    if (filter.entidad) where.entidad = { contains: filter.entidad, mode: 'insensitive' };

    if (filter.fechaInicio || filter.fechaFin) {
      where.createdAt = {};
      if (filter.fechaInicio) where.createdAt.gte = new Date(filter.fechaInicio);
      if (filter.fechaFin) where.createdAt.lte = new Date(filter.fechaFin);
    }

    // Aplicar filtro por segmento
    if (filter.segmento && filter.segmento !== 'TODOS') {
      const segWhere = this.buildSegmentoWhere(filter.segmento);
      if (segWhere.OR) {
        where.OR = segWhere.OR;
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
      totalPaginas: Math.ceil(total / limit),
    };
  }

  /**
   * Obtener resumen de actividades de seguridad del tenant o global,
   * incluyendo KPIs por segmento.
   */
  async obtenerResumenSeguridad(tenantId?: string, tenantIds?: string[]) {
    const where: any = {};
    if (tenantIds && tenantIds.length > 0) {
      where.tenantId = { in: tenantIds };
    } else if (tenantId) {
      where.tenantId = tenantId;
    }

    const totalEventos = await this.prisma.auditLog.count({ where });
    const operacionesCriticas = await this.prisma.auditLog.count({
      where: { ...where, accion: 'OPERACION_CRITICA' },
    });

    const loginsUltimas24h = await this.prisma.auditLog.count({
      where: {
        ...where,
        accion: 'LOGIN',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    const usuarios = await this.prisma.auditLog.groupBy({
      by: ['userId'],
      where: { ...where, userId: { not: null } },
    });

    // KPIs por segmento
    const cobrosWhere = this.buildSegmentoWhere('COBROS');
    const ventasWhere = this.buildSegmentoWhere('VENTAS');
    const pedidosWhere = this.buildSegmentoWhere('PEDIDOS');

    const [totalCobros, totalVentas, totalPedidos] = await Promise.all([
      this.prisma.auditLog.count({ where: { ...where, ...cobrosWhere } }),
      this.prisma.auditLog.count({ where: { ...where, ...ventasWhere } }),
      this.prisma.auditLog.count({ where: { ...where, ...pedidosWhere } }),
    ]);

    return {
      totalEventos,
      sensibles: operacionesCriticas,
      operacionesCriticas,
      usuariosConEventos: usuarios.length,
      loginsUltimas24h,
      totalCobros,
      totalVentas,
      totalPedidos,
    };
  }
}

