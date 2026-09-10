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
import { EncryptionService } from '../../../shared/infrastructure/encryption/encryption.service';

@Controller('reportes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportesController {
  constructor(
    private readonly reportesService: ReportesService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
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

    // Resolver los tenantIds según la selección del usuario.
    // Si no se envía sucursalId como query param, se usa req.user.tenantId
    // (que ya fue conmutado por JwtStrategy según el header x-sucursal-id).
    const tenantIds = sucursalId
      ? await this.resolverTenantIds(req.user.tenantId, sucursalId)
      : [req.user.tenantId];

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
      if (!userTenantId) return [];
      const mainTenant = await this.prisma.tenant.findUnique({
        where: { id: userTenantId },
        include: { businessConfig: true },
      });
      const plainRuc = mainTenant?.businessConfig?.ruc
        ? this.encryption.decrypt(mainTenant.businessConfig.ruc)
        : null;

      if (plainRuc) {
        const allTenants = await this.prisma.tenant.findMany({
          where: { active: true },
          include: { businessConfig: true },
        });
        const related = allTenants.filter((t) => {
          if (t.id === userTenantId) return true;
          if (t.businessConfig?.ruc) {
            return this.encryption.decrypt(t.businessConfig.ruc) === plainRuc;
          }
          return false;
        });
        return related.map((t) => t.id);
      }
      return [userTenantId];
    }

    // Un ID específico de sucursal
    return [sucursalId];
  }
}
