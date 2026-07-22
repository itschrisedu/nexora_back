import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import { FacturacionSriService } from '../application/FacturacionSriService';
import type { EmitirFacturaInput } from '../application/FacturacionSriService';

/**
 * FacturacionSriController — Endpoints REST para la emisión
 * de comprobantes electrónicos al SRI desde Nexora.
 *
 * POST /facturacion-sri/emitir       → Emitir factura electrónica
 * GET  /facturacion-sri/facturas     → Listar facturas del tenant
 * GET  /facturacion-sri/estado/:id   → Consultar estado de una factura
 */
@Controller('facturacion-sri')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacturacionSriController {
  constructor(
    private readonly facturacionService: FacturacionSriService,
  ) {}

  /**
   * Emitir una factura electrónica al SRI
   * Solo Administradores y Vendedores pueden emitir
   */
  @Post('emitir')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async emitirFactura(
    @Body() body: EmitirFacturaInput,
    @Req() req: any,
  ) {
    return this.facturacionService.emitirFactura(req.user.tenantId, body);
  }

  /**
   * Listar todas las facturas electrónicas del tenant
   */
  @Get('facturas')
  @Roles(Rol.ROL_ADMIN)
  async listarFacturas(@Req() req: any) {
    return this.facturacionService.listarFacturas(req.user.tenantId);
  }

  /**
   * Consultar el estado de una factura electrónica en el SRI
   */
  @Get('estado/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async consultarEstado(@Param('id') id: string, @Req() req: any) {
    return this.facturacionService.consultarEstado(req.user.tenantId, id);
  }
}
