import { Controller, Get, Post, Body, Query, Req, Param } from '@nestjs/common';
import { CatalogoService } from '../application/CatalogoService';
import type { RegistrarPedidoWhatsAppDto } from '../application/CatalogoService';

/**
 * CatalogoController — Endpoints PÚBLICOS para el Catálogo Digital y Venta por WhatsApp.
 * Accesible sin autenticación por los clientes finales.
 */
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly catalogoService: CatalogoService) {}

  /**
   * Obtener información pública del comercio (Logo, RUC, nombre, contacto)
   */
  @Get('tienda')
  async obtenerInfoTienda(@Query('tenantId') tenantId?: string) {
    return this.catalogoService.obtenerInfoTienda(tenantId);
  }

  /**
   * Obtener datos completos de la Landing Page pública (Hero, Sobre Nosotros, Sucursales activas)
   */
  @Get('landing')
  async obtenerLandingPublica(@Query('tenantId') tenantId?: string) {
    return this.catalogoService.obtenerLandingPublica(tenantId);
  }

  /**
   * Obtener catálogo de calzado disponible por sucursal específica
   */
  @Get('sucursal/:sucursalId')
  async obtenerCatalogoSucursal(@Param('sucursalId') sucursalId: string) {
    return this.catalogoService.obtenerCatalogoPublico(sucursalId);
  }

  /**
   * Obtener catálogo de calzado disponible
   */
  @Get('productos')
  async obtenerCatalogoPublico(@Query('tenantId') tenantId?: string, @Req() req?: any) {
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId && req?.headers?.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        if (token) {
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          if (payload && payload.tenantId) {
            resolvedTenantId = payload.tenantId;
          }
        }
      } catch (e) {
        // Ignorar error si el token no es válido o está malformado
      }
    }
    return this.catalogoService.obtenerCatalogoPublico(resolvedTenantId);
  }

  /**
   * Registrar un pedido generado desde el catálogo público de WhatsApp
   */
  @Post('pedido-whatsapp')
  async registrarPedidoWhatsApp(@Body() dto: RegistrarPedidoWhatsAppDto) {
    return this.catalogoService.registrarPedidoWhatsApp(dto);
  }
}
