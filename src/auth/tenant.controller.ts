import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TenantService } from './tenant.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';

@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Rol.ROL_SUPER_ADMIN)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  /**
   * GET /tenants
   * Lista todos los tenants con estadísticas.
   */
  @Get()
  async listTenants() {
    return this.tenantService.listTenants();
  }

  /**
   * GET /tenants/:id
   * Detalle de un tenant con todos sus usuarios.
   */
  @Get(':id')
  async getTenantDetail(@Param('id') id: string) {
    return this.tenantService.getTenantDetail(id);
  }

  /**
   * POST /tenants
   * Crear un nuevo tenant con admin inicial.
   */
  @Post()
  async createTenant(
    @Body()
    dto: {
      name: string;
      adminEmail: string;
      adminNombre: string;
      adminPassword: string;
    },
  ) {
    return this.tenantService.createTenant(dto);
  }

  /**
   * PATCH /tenants/:id/toggle
   * Activar/desactivar un tenant.
   */
  @Patch(':id/toggle')
  async toggleTenant(@Param('id') id: string) {
    return this.tenantService.toggleTenant(id);
  }
}
