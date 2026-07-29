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

export interface AuditFilterDto {
  tenantId: string;
  userId?: string;
  accion?: AccionAuditoria;
  entidad?: string;
  fechaInicio?: string;
  fechaFin?: string;
  page?: number;
  limit?: number;
}

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
   * Consultar bitácora de auditoría con filtros y paginación.
   */
  async buscarLogs(filter: AuditFilterDto) {
    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.tenantId) {
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
   * Obtener resumen de actividades de seguridad del tenant.
   */
  async obtenerResumenSeguridad(tenantId: string) {
    const totalEventos = await this.prisma.auditLog.count({ where: { tenantId } });
    const operacionesCriticas = await this.prisma.auditLog.count({
      where: { tenantId, accion: 'OPERACION_CRITICA' },
    });

    const loginsUltimas24h = await this.prisma.auditLog.count({
      where: {
        tenantId,
        accion: 'LOGIN',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    return {
      totalEventos,
      operacionesCriticas,
      loginsUltimas24h,
    };
  }
}
