import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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
   * Registrar devolucion de cliente (reingresa stock, ajusta cobro FIFO, calcula saldo a favor)
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
      tipoDevolucion?: 'SERIE_COMPLETA' | 'TALLA_ESPECIFICA';
      destinoStock?: 'REINGRESO_INVENTARIO' | 'BAJA_POR_FALLA';
      lines: {
        productId: string;
        tallaId: string;
        cantidad: number;
        precioUnitario: number;
      }[];
    },
    @Req() req: any,
  ) {
    return this.devolucionesService.registrarDevolucionCliente(
      dto,
      req.user.tenantId,
      req.user.sub || req.user.id,
    );
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
   * GET /devoluciones/cliente/pendientes-proveedor
   * Listar devoluciones de clientes pendientes de devolver al proveedor (BAJA_POR_FALLA)
   */
  @Get('cliente/pendientes-proveedor')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN, Rol.ROL_BODEGUERO)
  async listarPendientesProveedor(@Req() req: any) {
    return this.devolucionesService.listarPendientesProveedor(req.user.tenantId);
  }

  /**
   * POST /devoluciones/mercaderia-por-devolver/manual
   * Registrar calzado defectuoso directamente en la bandeja de pendientes por devolver
   */
  @Post('mercaderia-por-devolver/manual')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN, Rol.ROL_BODEGUERO)
  async registrarMercaderiaPorDevolverManual(
    @Body()
    dto: {
      motivo: string;
      clientId?: string;
      lines: {
        productId: string;
        tallaId: string;
        cantidad: number;
        precioUnitario?: number;
      }[];
    },
    @Req() req: any,
  ) {
    return this.devolucionesService.registrarMercaderiaPorDevolverManual(
      dto,
      req.user.tenantId,
      req.user.sub || req.user.id,
    );
  }

  /**
   * POST /devoluciones/cliente/:id/pagar-excedente
   * Pagar el saldo a favor al cliente en efectivo
   */
  @Post('cliente/:id/pagar-excedente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async pagarExcedenteCliente(
    @Param('id') devolucionId: string,
    @Body() dto: { metodo?: string },
    @Req() req: any,
  ) {
    return this.devolucionesService.pagarExcedenteCliente(
      devolucionId,
      req.user.tenantId,
      req.user.sub || req.user.id,
      dto.metodo,
    );
  }

  /**
   * POST /devoluciones/aplicar-saldo-cliente
   * Aplicar saldo a favor del cliente en un cobro existente ("hacer paso")
   */
  @Post('aplicar-saldo-cliente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  async aplicarSaldoFavorCliente(
    @Body() dto: { clientId: string; cobroId: string; montoAplicar?: number },
    @Req() req: any,
  ) {
    return this.devolucionesService.aplicarSaldoFavorCliente(
      dto,
      req.user.tenantId,
      req.user.sub || req.user.id,
    );
  }

  /**
   * POST /devoluciones/proveedor
   * Registrar devolucion a proveedor (descuenta stock, ajusta deuda FIFO, calcula saldo a favor)
   */
  @Post('proveedor')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async registrarDevolucionProveedor(
    @Body()
    dto: {
      entradaId?: string;
      supplierId: string;
      motivo: string;
      clienteDevolucionId?: string;
      lines: {
        productId: string;
        tallaId: string;
        cantidad: number;
        precioCosto: number;
      }[];
    },
    @Req() req: any,
  ) {
    return this.devolucionesService.registrarDevolucionProveedor(
      dto,
      req.user.tenantId,
      req.user.sub || req.user.id,
    );
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

  /**
   * POST /devoluciones/proveedor/:id/pagar-excedente
   * Registrar pago del proveedor por excedente
   */
  @Post('proveedor/:id/pagar-excedente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async recibirPagoExcedenteProveedor(
    @Param('id') devolucionId: string,
    @Body() dto: { metodo?: string },
    @Req() req: any,
  ) {
    return this.devolucionesService.recibirPagoExcedenteProveedor(
      devolucionId,
      req.user.tenantId,
      req.user.sub || req.user.id,
      dto.metodo,
    );
  }

  /**
   * POST /devoluciones/aplicar-saldo-proveedor
   * Aplicar saldo a favor del negocio en una deuda con proveedor ("hacer paso")
   */
  @Post('aplicar-saldo-proveedor')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async aplicarSaldoFavorProveedor(
    @Body() dto: { supplierId: string; deudaId: string; montoAplicar?: number },
    @Req() req: any,
  ) {
    return this.devolucionesService.aplicarSaldoFavorProveedor(
      dto,
      req.user.tenantId,
      req.user.sub || req.user.id,
    );
  }
}
