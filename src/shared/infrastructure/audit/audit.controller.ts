import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { AuditService } from './audit.service';
import { AccionAuditoria } from '@prisma/client';

@Controller('auditoria')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /auditoria
   * Consulta logs de auditoría con filtros y paginación.
   */
  @Get()
  async obtenerLogs(
    @Request() req: any,
    @Query('userId') userId?: string,
    @Query('accion') accion?: AccionAuditoria,
    @Query('entidad') entidad?: string,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.auditService.buscarLogs({
      tenantId,
      userId,
      accion,
      entidad,
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
    const tenantId = req.user.tenantId;
    return this.auditService.obtenerResumenSeguridad(tenantId);
  }

  @Get('stats')
  async obtenerStats(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.auditService.obtenerResumenSeguridad(tenantId);
  }
}
