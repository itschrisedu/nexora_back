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
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';

@Controller('reportes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportesController {
  constructor(
    private readonly reportesService: ReportesService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /reportes/resumen-ejecutivo
   * Obtiene el reporte analítico y KPIs con multi-filtro.
   * Si se envía sucursalId = "TODAS", se agregan todas las sucursales del negocio.
   * Si se envía un ID específico, se filtra solo esa sucursal.
   * Si no se envía, se usa el tenantId del usuario autenticado.
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
    @Query('sucursalId') sucursalId?: string,
  ) {
    const filtros: FiltrosReporteDto = {
      periodo,
      fechaDesde,
      fechaHasta,
      vendedorId,
      canal,
    };

    // Resolver los tenantIds según la selección del usuario
    const tenantIds = await this.resolverTenantIds(req.user.tenantId, sucursalId);

    return this.reportesService.obtenerReporteEjecutivo(tenantIds, filtros);
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

  /**
   * Resuelve los tenantIds según la selección del Admin.
   * - "TODAS" o vacío → todas las sucursales de la empresa (mismo RUC).
   * - Un ID específico → solo ese tenantId.
   */
  private async resolverTenantIds(userTenantId: string, sucursalId?: string): Promise<string[]> {
    if (!sucursalId || sucursalId === 'TODAS') {
      // Obtener todas las sucursales del negocio del admin
      const mainTenant = await this.prisma.tenant.findUnique({
        where: { id: userTenantId },
        include: { businessConfig: true },
      });
      const ruc = mainTenant?.businessConfig?.ruc;

      if (ruc) {
        const relatedTenants = await this.prisma.tenant.findMany({
          where: { businessConfig: { ruc }, active: true },
          select: { id: true },
        });
        return relatedTenants.map((t) => t.id);
      }
      return [userTenantId];
    }

    // Un ID específico de sucursal
    return [sucursalId];
  }
}
