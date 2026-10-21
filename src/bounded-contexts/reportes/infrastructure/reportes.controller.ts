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
    @Query('periodo') periodo?: 'HOY' | 'SEMANAL' | 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' | 'PERSONALIZADO',
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('vendedorId') vendedorId?: string,
    @Query('canal') canal?: string,
    @Query('sucursalId') sucursalId?: string,
  ) {
    const userRole = req.user?.rol || req.user?.role;
    const isVendedor = userRole === Rol.ROL_VENDEDOR;
    const esAdminGeneral = Boolean(req.user?.esAdminGeneral);
    const isSuperAdmin = userRole === Rol.ROL_SUPER_ADMIN;

    // Regla de Negocio: Vendedor ve exclusivamente sus propias ventas
    const effectiveVendedorId = isVendedor ? (req.user.sub || req.user.id) : vendedorId;

    const filtros: FiltrosReporteDto = {
      periodo,
      fechaDesde,
      fechaHasta,
      vendedorId: effectiveVendedorId,
      canal,
    };

    const tenantIds = await this.determinarTenantIds(req, sucursalId);
    return this.reportesService.obtenerReporteEjecutivo(tenantIds, filtros);
  }

  /**
   * GET /reportes/vendedores
   * Lista de trabajadores para el filtro de vendedor
   */
  @Get('vendedores')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async listarVendedores(@Req() req: any) {
    const userRole = req.user?.rol || req.user?.role;
    if (userRole === Rol.ROL_VENDEDOR) {
      return [
        {
          id: req.user.sub || req.user.id,
          nombre: req.user.nombre || req.user.email || 'Mi Usuario (Vendedor)',
          email: req.user.email,
          rol: userRole,
        },
      ];
    }
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
   * GET /reportes/cobranzas
   * Reporte de clientes que deben con detalle de notas pendientes
   */
  @Get('cobranzas')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async obtenerReporteCobranzas(
    @Req() req: any,
    @Query('periodo') periodo?: 'HOY' | 'SEMANAL' | 'MENSUAL' | 'TRIMESTRAL' | 'ANUAL' | 'PERSONALIZADO',
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('sucursalId') sucursalId?: string,
  ) {
    const filtros: FiltrosReporteDto = { periodo, fechaDesde, fechaHasta };
    const tenantIds = await this.determinarTenantIds(req, sucursalId);
    return this.reportesService.obtenerReporteCobranzas(tenantIds, filtros);
  }

  /**
   * GET /reportes/campanas
   * Reporte de rendimiento de campañas promocionales
   */
  @Get('campanas')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async obtenerReporteCampanas(
    @Req() req: any,
    @Query('sucursalId') sucursalId?: string,
  ) {
    const tenantIds = await this.determinarTenantIds(req, sucursalId);
    return this.reportesService.obtenerReporteCampanas(tenantIds);
  }

  /**
   * GET /reportes/pos
   * Reporte detallado del Punto de Venta (POS / Mostrador) con filtros por fecha, sucursal, vendedor y método de pago
   */
  @Get('pos')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerReportePos(
    @Req() req: any,
    @Query('periodo') periodo?: 'HOY' | 'SEMANAL' | 'MENSUAL' | 'TRIMESTRAL' | 'ANUAL' | 'PERSONALIZADO',
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('vendedorId') vendedorId?: string,
    @Query('metodoPago') metodoPago?: string,
    @Query('modelo') modelo?: string,
    @Query('busqueda') busqueda?: string,
    @Query('sucursalId') sucursalId?: string,
  ) {
    const userRole = req.user?.rol || req.user?.role;
    const isVendedor = userRole === Rol.ROL_VENDEDOR;

    const effectiveVendedorId = isVendedor ? (req.user.sub || req.user.id) : vendedorId;
    const filtros = { periodo, fechaDesde, fechaHasta, vendedorId: effectiveVendedorId, metodoPago, modelo, busqueda };
    const tenantIds = await this.determinarTenantIds(req, sucursalId);
    return this.reportesService.obtenerReportePos(tenantIds, filtros);
  }

  /**
   * GET /reportes/rendimiento-sucursales
   * Reporte de rendimiento por sucursal y desglose de ventas de modelos por sucursal
   */
  @Get('rendimiento-sucursales')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async obtenerReporteRendimientoSucursales(
    @Req() req: any,
    @Query('periodo') periodo?: 'HOY' | 'SEMANAL' | 'MENSUAL' | 'TRIMESTRAL' | 'ANUAL' | 'PERSONALIZADO',
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('sucursalId') sucursalId?: string,
  ) {
    const userRole = req.user?.rol || req.user?.role;
    const esAdminGeneral = Boolean(req.user?.esAdminGeneral);
    const isSuperAdmin = userRole === Rol.ROL_SUPER_ADMIN;

    const filtros = { periodo, fechaDesde, fechaHasta };
    let allTenantIds: string[];
    let targetSucursalId: string | undefined;

    if (isSuperAdmin || esAdminGeneral) {
      allTenantIds = await this.resolverTenantIds(req.user.tenantId, 'TODAS');
      targetSucursalId = sucursalId && sucursalId !== 'TODAS' ? sucursalId : undefined;
    } else {
      // Administrador de Sucursal o Vendedor: estrictamente limitado a su propio local
      const localTenant = req.user.originalTenantId || req.user.tenantId;
      allTenantIds = [localTenant];
      targetSucursalId = localTenant;
    }

    return this.reportesService.obtenerReporteRendimientoSucursales(allTenantIds, targetSucursalId, filtros);
  }

  /**
   * Determina los tenantIds permitidos según el rol del usuario autenticado:
   * - Super Administrador: intacto (mantiene su lógica original).
   * - Vendedor o Admin de Sucursal: forzado a su propio local (tenantId).
   * - Admin General: puede alternar entre "TODAS" (todas las sedes) o una sede en particular.
   */
  private async determinarTenantIds(req: any, sucursalId?: string): Promise<string[]> {
    const userRole = req.user?.rol || req.user?.role;
    const isVendedor = userRole === Rol.ROL_VENDEDOR;
    const esAdminGeneral = Boolean(req.user?.esAdminGeneral);
    const isSuperAdmin = userRole === Rol.ROL_SUPER_ADMIN;

    if (isSuperAdmin) {
      return sucursalId
        ? await this.resolverTenantIds(req.user.tenantId, sucursalId)
        : [req.user.tenantId];
    }

    if (isVendedor || (!esAdminGeneral && userRole === Rol.ROL_ADMIN)) {
      return [req.user.originalTenantId || req.user.tenantId];
    }

    return sucursalId
      ? await this.resolverTenantIds(req.user.tenantId, sucursalId)
      : [req.user.tenantId];
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
