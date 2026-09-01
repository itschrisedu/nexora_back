import { Controller, Post, Get, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import { PosService } from '../application/PosService';
import type { AbrirCajaDto, RegistrarVentaPosDto, CerrarCajaDto } from '../application/PosService';

/**
 * PosController — Endpoints REST para la Venta al Detalle (POS Mostrador)
 * y el Arqueo / Cierre de Caja y Período.
 */
@Controller('pos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  /**
   * Abrir un turno / caja de venta
   */
  @Post('caja/abrir')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  async abrirCaja(@Body() body: AbrirCajaDto, @Req() req: any) {
    return this.posService.abrirCaja(req.user.tenantId, req.user.sub, body);
  }

  /**
   * Obtener el estado y resumen actual de la caja abierta
   */
  @Get('caja/estado')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  async obtenerEstadoCaja(@Req() req: any) {
    return this.posService.obtenerEstadoCaja(req.user.tenantId);
  }

  /**
   * Obtener productos y stock disponible para venta en mostrador
   */
  @Get('productos-disponibles')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN, Rol.ROL_BODEGUERO)
  async obtenerProductosDisponibles(@Req() req: any) {
    return this.posService.obtenerProductosDisponibles(req.user.tenantId);
  }

  /**
   * Registrar una Venta Directa en Mostrador (POS)
   */
  @Post('venta-directa')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  async registrarVentaDirectaPOS(@Body() body: RegistrarVentaPosDto, @Req() req: any) {
    return this.posService.registrarVentaDirectaPOS(
      req.user.tenantId,
      req.user.sub,
      body,
    );
  }

  /**
   * Realizar el arqueo y Cierre de Caja / Turno
   */
  @Post('caja/cerrar')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  async cerrarCajaArqueo(@Body() body: CerrarCajaDto, @Req() req: any) {
    return this.posService.cerrarCajaArqueo(
      req.user.tenantId,
      req.user.sub,
      body,
    );
  }
}
