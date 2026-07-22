import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { DevolucionesService } from '../application/DevolucionesService';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';

@Controller('devoluciones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevolucionesController {
  constructor(private readonly devolucionesService: DevolucionesService) {}

  /**
   * POST /devoluciones/cliente
   * Registrar devolución de cliente (reingresa stock y ajusta cobro)
   */
  @Post('cliente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  async registrarDevolucionCliente(
    @Body()
    dto: {
      saleNoteId?: string;
      orderId?: string;
      clientId: string;
      motivo: string;
      lines: {
        productId: string;
        tallaId: string;
        cantidad: number;
        precioUnitario: number;
      }[];
    },
    @Req() req: any,
  ) {
    return this.devolucionesService.registrarDevolucionCliente(dto, req.user.tenantId);
  }

  /**
   * GET /devoluciones/cliente
   * Listar devoluciones de clientes
   */
  @Get('cliente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  async listarDevolucionesCliente(@Req() req: any) {
    return this.devolucionesService.listarDevolucionesCliente(req.user.tenantId);
  }

  /**
   * POST /devoluciones/proveedor
   * Registrar devolución a proveedor (descuenta stock por garantía/defecto y ajusta deuda)
   */
  @Post('proveedor')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async registrarDevolucionProveedor(
    @Body()
    dto: {
      entradaId?: string;
      supplierId: string;
      motivo: string;
      lines: {
        productId: string;
        tallaId: string;
        cantidad: number;
        precioCosto: number;
      }[];
    },
    @Req() req: any,
  ) {
    return this.devolucionesService.registrarDevolucionProveedor(dto, req.user.tenantId);
  }

  /**
   * GET /devoluciones/proveedor
   * Listar devoluciones a proveedores
   */
  @Get('proveedor')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async listarDevolucionesProveedor(@Req() req: any) {
    return this.devolucionesService.listarDevolucionesProveedor(req.user.tenantId);
  }
}
