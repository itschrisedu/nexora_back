import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TenantService } from './tenant.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';

@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  /**
   * GET /tenants/my-status
   * Consulta el estado de suscripción, período de gracia y opacidad del tenant actual.
   * Accesible para cualquier usuario autenticado de un tenant.
   */
  @Get('my-status')
  @UseGuards(JwtAuthGuard)
  async getMySubscriptionStatus(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      // Para Super Admin general o usuarios sin tenantId
      return {
        tenantId: 'SUPER_ADMIN',
        tenantName: 'Super Administrador NEXORA',
        plan: 'PLAN_MAYORISTA',
        estadoSuscripcion: 'ACTIVA',
        diasRestantes: 999,
        diasVencido: 0,
        stage: 'OK',
        opacidad: 1.0,
        bloqueado: false,
        mensaje: 'Sesión Maestra Super Admin activa.',
        maxSucursales: 999,
        maxUsuarios: 999,
        precioMensualPlan: 0,
      };
    }
    return this.tenantService.getSubscriptionStatus(tenantId);
  }

  /**
   * GET /tenants
   * Lista todos los tenants con estadísticas y suscripciones (Solo Super Admin).
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async listTenants() {
    return this.tenantService.listTenants();
  }

  /**
   * GET /tenants/reportes/ingresos-suscripciones
   * Reporte global consolidado de ingresos por suscripción y estado de locales para Super Admin.
   */
  @Get('reportes/ingresos-suscripciones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async getSubscriptionReport() {
    return this.tenantService.getGlobalSubscriptionReport();
  }

  /**
   * GET /tenants/:id
   * Detalle de un tenant con todos sus usuarios y pagos.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async getTenantDetail(@Param('id') id: string) {
    return this.tenantService.getTenantDetail(id);
  }

  /**
   * GET /tenants/:id/subscription
   * Obtener estado de suscripción de un tenant específico.
   */
  @Get(':id/subscription')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async getTenantSubscription(@Param('id') id: string) {
    return this.tenantService.getSubscriptionStatus(id);
  }

  /**
   * POST /tenants
   * Crear un nuevo tenant con admin inicial y plan.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async createTenant(
    @Body()
    dto: {
      name: string;
      adminEmail: string;
      adminNombre: string;
      adminPassword: string;
      plan?: any;
      diasPruebaGratis?: number;
      maxSucursales?: number;
      maxUsuarios?: number;
      precioMensualPlan?: number;
    },
  ) {
    return this.tenantService.createTenant(dto);
  }

  /**
   * PATCH /tenants/:id
   * Actualizar nombre, configuración de negocio o plan de un tenant.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async updateTenant(@Param('id') id: string, @Body() dto: any) {
    return this.tenantService.updateTenant(id, dto);
  }

  /**
   * POST /tenants/:id/subscription-payment
   * Registrar pago de suscripción mensual/anual y extender fecha de vigencia.
   */
  @Post(':id/subscription-payment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async registerSubscriptionPayment(
    @Param('id') id: string,
    @Body()
    dto: {
      monto: number;
      periodoMeses: number;
      metodoPago?: string;
      plan?: any;
      numeroFacturaSri?: string;
      facturaAutorizada?: boolean;
      comprobanteUrl?: string;
      notas?: string;
    },
  ) {
    return this.tenantService.registerSubscriptionPayment(id, dto);
  }

  /**
   * GET /tenants/:id/subscription-payments
   * Listar historial de pagos de suscripción de un tenant.
   */
  @Get(':id/subscription-payments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async listSubscriptionPayments(@Param('id') id: string) {
    return this.tenantService.listSubscriptionPayments(id);
  }

  /**
   * DELETE /tenants/:id
   * Eliminar un tenant y todos sus datos.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async deleteTenant(@Param('id') id: string) {
    return this.tenantService.deleteTenant(id);
  }

  /**
   * PATCH /tenants/:id/toggle
   * Activar/desactivar un tenant.
   */
  @Patch(':id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async toggleTenant(@Param('id') id: string) {
    return this.tenantService.toggleTenant(id);
  }

  /**
   * POST /tenants/:id/users
   * Crear un nuevo usuario en un tenant específico.
   */
  @Post(':id/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async createUserForTenant(@Param('id') id: string, @Body() dto: any) {
    return this.tenantService.createUserForTenant(id, dto);
  }

  /**
   * PATCH /tenants/users/:userId
   * Editar usuario existente.
   */
  @Patch('users/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async updateUserForTenant(@Param('userId') userId: string, @Body() dto: any) {
    return this.tenantService.updateUserForTenant(userId, dto);
  }

  /**
   * DELETE /tenants/users/:userId
   * Eliminar usuario.
   */
  @Delete('users/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_SUPER_ADMIN)
  async deleteUserForTenant(@Param('userId') userId: string) {
    return this.tenantService.deleteUser(userId);
  }
}
