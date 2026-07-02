import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import {
  CrearProductoDto,
  CambiarPrecioDto,
  ReservarStockDto,
  MovimientoStockDto,
  BuscarProductosDto,
} from './dto/inventario.dto';
import { CrearProductoHandler } from '../application/commands/CrearProducto.handler';
import { CrearProductoCommand } from '../application/commands/CrearProducto.command';
import { CambiarPrecioHandler } from '../application/commands/CambiarPrecio.handler';
import { CambiarPrecioCommand } from '../application/commands/CambiarPrecio.command';
import { ReservarStockHandler } from '../application/commands/ReservarStock.handler';
import { ReservarStockCommand } from '../application/commands/ReservarStock.command';
import { LiberarReservaHandler } from '../application/commands/LiberarReserva.handler';
import { LiberarReservaCommand } from '../application/commands/LiberarReserva.command';
import { AumentarStockHandler } from '../application/commands/AumentarStock.handler';
import { AumentarStockCommand } from '../application/commands/AumentarStock.command';
import { DescontarStockHandler } from '../application/commands/DescontarStock.handler';
import { DescontarStockCommand } from '../application/commands/DescontarStock.command';
import { InventarioQueryService } from '../application/queries/InventarioQueryService';

@Controller('inventario')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventarioController {
  constructor(
    private readonly crearProductoHandler: CrearProductoHandler,
    private readonly cambiarPrecioHandler: CambiarPrecioHandler,
    private readonly reservarStockHandler: ReservarStockHandler,
    private readonly liberarReservaHandler: LiberarReservaHandler,
    private readonly aumentarStockHandler: AumentarStockHandler,
    private readonly descontarStockHandler: DescontarStockHandler,
    private readonly queryService: InventarioQueryService,
  ) {}

  // ══════════════════════════════
  // QUERIES
  // ══════════════════════════════

  @Get('productos')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async buscarProductos(@Query() query: BuscarProductosDto) {
    return this.queryService.buscarProductos(query);
  }

  @Get('productos/stock-bajo')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async obtenerStockBajo() {
    return this.queryService.obtenerStockBajo();
  }

  @Get('productos/serie/:serie')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerPorSerie(@Param('serie') serie: string) {
    return this.queryService.obtenerProductosPorSerie(serie);
  }

  @Get('productos/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerProducto(@Param('id') id: string) {
    return this.queryService.obtenerProducto(id);
  }

  @Get('productos/:id/movimientos')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async obtenerMovimientos(@Param('id') id: string) {
    return this.queryService.obtenerMovimientos(id);
  }

  // ══════════════════════════════
  // COMMANDS
  // ══════════════════════════════

  @Post('productos')
  @Roles(Rol.ROL_ADMIN)
  async crearProducto(@Body() dto: CrearProductoDto) {
    const command = new CrearProductoCommand(
      dto.codigo,
      dto.nombre,
      dto.marca,
      dto.modelo,
      dto.material ?? null,
      dto.fotoUrl ?? null,
      dto.precioCosto,
      dto.precioVenta,
      dto.serieId,
      dto.tallas,
    );
    const id = await this.crearProductoHandler.execute(command);
    return { id, message: 'Producto creado exitosamente' };
  }

  @Patch('productos/:id/precio')
  @Roles(Rol.ROL_ADMIN)
  async cambiarPrecio(
    @Param('id') id: string,
    @Body() dto: CambiarPrecioDto,
    @Req() req: any,
  ) {
    const command = new CambiarPrecioCommand(
      id,
      dto.nuevoPrecioCosto,
      dto.nuevoPrecioVenta,
      req.user.sub,
      dto.motivo,
    );
    await this.cambiarPrecioHandler.execute(command);
    return { message: 'Precio actualizado exitosamente' };
  }

  @Post('productos/:id/reservar')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async reservarStock(@Param('id') id: string, @Body() dto: ReservarStockDto) {
    const command = new ReservarStockCommand(
      id,
      dto.tallaId,
      dto.cantidad,
      dto.motivo,
      dto.referenceId ?? null,
      dto.ttlMinutos,
    );
    const reservaId = await this.reservarStockHandler.execute(command);
    return { reservaId, message: 'Stock reservado exitosamente' };
  }

  @Delete('reservas/:reservaId')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async liberarReserva(@Param('reservaId') reservaId: string) {
    await this.liberarReservaHandler.execute(
      new LiberarReservaCommand(reservaId),
    );
    return { message: 'Reserva liberada exitosamente' };
  }

  @Post('productos/:id/entrada')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async aumentarStock(
    @Param('id') id: string,
    @Body() dto: MovimientoStockDto,
    @Req() req: any,
  ) {
    const command = new AumentarStockCommand(
      id,
      dto.tallaId,
      dto.cantidad,
      dto.motivo,
      dto.referenceId ?? null,
      req.user.sub,
    );
    await this.aumentarStockHandler.execute(command);
    return { message: 'Stock incrementado exitosamente' };
  }

  @Post('productos/:id/salida')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async descontarStock(
    @Param('id') id: string,
    @Body() dto: MovimientoStockDto,
    @Req() req: any,
  ) {
    const command = new DescontarStockCommand(
      id,
      dto.tallaId,
      dto.cantidad,
      dto.motivo,
      dto.referenceId ?? null,
      req.user.sub,
    );
    await this.descontarStockHandler.execute(command);
    return { message: 'Stock descontado exitosamente' };
  }
}
