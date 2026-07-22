import { Controller, Get, Post, Body, Query } from '@nestjs/common';
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
   * Obtener catálogo de calzado disponible
   */
  @Get('productos')
  async obtenerCatalogoPublico(@Query('tenantId') tenantId?: string) {
    return this.catalogoService.obtenerCatalogoPublico(tenantId);
  }

  /**
   * Registrar un pedido generado desde el catálogo público de WhatsApp
   */
  @Post('pedido-whatsapp')
  async registrarPedidoWhatsApp(@Body() dto: RegistrarPedidoWhatsAppDto) {
    return this.catalogoService.registrarPedidoWhatsApp(dto);
  }
}
