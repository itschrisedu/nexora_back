import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import { RegistrarAbonoHandler } from '../application/commands/RegistrarAbono.handler';
import { RegistrarPagoProveedorHandler } from '../application/commands/RegistrarPagoProveedor.handler';
import { FinancieroQueryService } from '../application/queries/FinancieroQueryService';

@Controller('financiero')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinancieroController {
  constructor(
    private readonly registrarAbonoHandler: RegistrarAbonoHandler,
    private readonly registrarPagoProveedorHandler: RegistrarPagoProveedorHandler,
    private readonly queryService: FinancieroQueryService,
  ) {}

  // ══════════════════════════════════════════
  // RESUMEN
  // ══════════════════════════════════════════

  @Get('resumen')
  @Roles(Rol.ROL_ADMIN)
  resumen(@Req() req: any) {
    return this.queryService.resumenFinanciero(req.user.tenantId);
  }

  // ══════════════════════════════════════════
  // COBROS
  // ══════════════════════════════════════════

  @Get('cobros/vencidos')
  @Roles(Rol.ROL_ADMIN)
  cobrosVencidos(@Req() req: any) {
    return this.queryService.listarCobrosVencidos(req.user.tenantId);
  }

  @Get('cobros/proximos-a-vencer')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  cobrosProximosAVencer(@Req() req: any, @Query('dias') dias?: string) {
    return this.queryService.listarCobrosProximosAVencer(dias ? parseInt(dias) : 7, req.user.tenantId);
  }

  @Get('cobros/cliente/:clientId')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  cobrosCliente(@Param('clientId') clientId: string, @Req() req: any) {
    return this.queryService.listarCobrosCliente(clientId, req.user.tenantId);
  }

  @Get('cobros/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  obtenerCobro(@Param('id') id: string) {
    return this.queryService.obtenerCobro(id);
  }

  @Post('cobros/:id/abono')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async registrarAbono(
    @Param('id') cobroId: string,
    @Body() body: { monto: number; metodo: string; notas?: string },
    @Req() req: any,
  ) {
    await this.registrarAbonoHandler.execute({
      cobroId,
      monto: body.monto,
      metodo: body.metodo,
      notas: body.notas,
      userId: req.user.sub,
    });
    return { ok: true, message: 'Abono registrado correctamente' };
  }

  // ══════════════════════════════════════════
  // NOTAS DE VENTA
  // ══════════════════════════════════════════

  @Get('notas-venta/cliente/:clientId')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  notasVentaCliente(@Param('clientId') clientId: string, @Req() req: any) {
    return this.queryService.listarNotasVentaCliente(clientId, req.user.tenantId);
  }

  @Get('notas-venta/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  obtenerNotaVenta(@Param('id') id: string) {
    return this.queryService.obtenerNotaVenta(id);
  }

  // ══════════════════════════════════════════
  // DEUDAS PROVEEDOR
  // ══════════════════════════════════════════

  @Get('deudas-proveedor')
  @Roles(Rol.ROL_ADMIN)
  listarDeudas(@Req() req: any, @Query('supplierId') supplierId?: string) {
    return this.queryService.listarDeudasProveedor(supplierId, req.user.tenantId);
  }

  @Get('deudas-proveedor/vencidas')
  @Roles(Rol.ROL_ADMIN)
  deudasVencidas(@Req() req: any) {
    return this.queryService.listarDeudasVencidas(req.user.tenantId);
  }

  @Get('deudas-proveedor/:id')
  @Roles(Rol.ROL_ADMIN)
  obtenerDeuda(@Param('id') id: string) {
    return this.queryService.obtenerDeudaProveedor(id);
  }

  @Post('deudas-proveedor/:id/pago')
  @Roles(Rol.ROL_ADMIN)
  async registrarPago(
    @Param('id') deudaId: string,
    @Body() body: { monto: number; metodo: string; notas?: string },
    @Req() req: any,
  ) {
    await this.registrarPagoProveedorHandler.execute({
      deudaId,
      monto: body.monto,
      metodo: body.metodo,
      notas: body.notas,
      userId: req.user.sub,
    });
    return { ok: true, message: 'Pago a proveedor registrado correctamente' };
  }
}
