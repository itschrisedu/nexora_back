import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { AuditService } from './audit.service';
import type { AuditSegmento } from './audit.service';
import { AccionAuditoria } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('auditoria')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolverTenantIds(req: any): Promise<{ tenantId?: string; tenantIds?: string[] }> {
    if (req.user.isAllSucursales && req.user.originalTenantId) {
      const userConfig = await this.prisma.businessConfig.findUnique({
        where: { tenantId: req.user.originalTenantId },
        select: { ruc: true },
      });
      if (userConfig?.ruc) {
        const hermanas = await this.prisma.businessConfig.findMany({
          where: { ruc: userConfig.ruc },
          select: { tenantId: true },
        });
        return { tenantIds: hermanas.map((h) => h.tenantId) };
      }
    }
    return { tenantId: req.user.tenantId };
  }

  /**
   * GET /auditoria
   * Consulta logs de auditoría con filtros, segmentación y paginación.
   */
  @Get()
  async obtenerLogs(
    @Request() req: any,
    @Query('userId') userId?: string,
    @Query('accion') accion?: AccionAuditoria,
    @Query('entidad') entidad?: string,
    @Query('segmento') segmento?: AuditSegmento,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { tenantId, tenantIds } = await this.resolverTenantIds(req);
    return this.auditService.buscarLogs({
      tenantId,
      tenantIds,
      userId,
      accion,
      entidad,
      segmento,
      fechaInicio,
      fechaFin,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  /**
   * GET /auditoria/resumen & GET /auditoria/stats
   * Retorna KPIs de seguridad y auditoría.
   */
  @Get('resumen')
  async obtenerResumen(@Request() req: any) {
    const { tenantId, tenantIds } = await this.resolverTenantIds(req);
    return this.auditService.obtenerResumenSeguridad(tenantId, tenantIds);
  }

  @Get('stats')
  async obtenerStats(@Request() req: any) {
    const { tenantId, tenantIds } = await this.resolverTenantIds(req);
    return this.auditService.obtenerResumenSeguridad(tenantId, tenantIds);
  }
}
