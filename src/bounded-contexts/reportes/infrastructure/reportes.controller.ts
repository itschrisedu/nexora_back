import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import { ReportesService, FiltrosReporteDto } from '../application/ReportesService';

@Controller('reportes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportesController {
  constructor(private readonly reportesService: ReportesService) {}

  /**
   * GET /reportes/resumen-ejecutivo
   * Obtiene el reporte analítico y KPIs con multi-filtro
   */
  @Get('resumen-ejecutivo')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerResumenEjecutivo(
    @Req() req: any,
    @Query('periodo') periodo?: 'HOY' | 'SEMANAL' | 'MENSUAL' | 'TRIMESTRAL' | 'ANUAL' | 'PERSONALIZADO',
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('vendedorId') vendedorId?: string,
    @Query('canal') canal?: string,
  ) {
    const filtros: FiltrosReporteDto = {
      periodo,
      fechaDesde,
      fechaHasta,
      vendedorId,
      canal,
    };
    return this.reportesService.obtenerReporteEjecutivo(req.user.tenantId, filtros);
  }

  /**
   * GET /reportes/vendedores
   * Lista de trabajadores para el filtro de vendedor
   */
  @Get('vendedores')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async listarVendedores(@Req() req: any) {
    return this.reportesService.listarVendedores(req.user.tenantId);
  }

  /**
   * GET /reportes/proyeccion-ml
   * Pronóstico de demanda con el microservicio nexora_ml
   */
  @Get('proyeccion-ml')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN, Rol.ROL_VENDEDOR)
  async obtenerProyeccionDemanda(
    @Req() req: any,
    @Query('horizonteDias') horizonteDias?: string,
  ) {
    const dias = parseInt(horizonteDias || '30', 10);
    return this.reportesService.obtenerProyeccionDemandaMl(req.user.tenantId, dias);
  }
}
