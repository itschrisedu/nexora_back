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
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import {
  CrearModeloDto,
  CambiarPrecioDto,
  ReservarStockDto,
  MovimientoStockDto,
  BuscarProductosDto,
} from './dto/inventario.dto';
import { CrearProductoHandler } from '../application/commands/CrearProducto.handler';
import { CrearModeloCommand } from '../application/commands/CrearProducto.command';
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
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';

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
    private readonly prisma: PrismaService,
  ) {}

  // ══════════════════════════════
  // QUERIES
  // ══════════════════════════════

  @Get('productos')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async buscarProductos(@Query() query: BuscarProductosDto, @Req() req: any) {
    return this.queryService.buscarProductos(query, req.user.tenantId);
  }

  @Get('productos/stock-bajo')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async obtenerStockBajo(@Req() req: any) {
    return this.queryService.obtenerStockBajo(req.user.tenantId);
  }

  @Get('productos/serie/:serie')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerPorSerie(@Param('serie') serie: string, @Req() req: any) {
    return this.queryService.obtenerProductosPorSerie(serie, req.user.tenantId);
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

  @Get('modelos')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async listarModelos(@Req() req: any) {
    return this.queryService.listarModelos(req.user.tenantId);
  }

  // ══════════════════════════════
  // COMMANDS
  // ══════════════════════════════

  @Post('modelos')
  @Roles(Rol.ROL_ADMIN)
  async crearModelo(@Body() dto: CrearModeloDto, @Req() req: any) {
    const command = new CrearModeloCommand(
      dto.baseCode,
      dto.name,
      dto.brand,
      dto.material ?? null,
      dto.costPrice,
      dto.salePrice,
      dto.colors.map(c => ({ color: c.color, imageUrl: c.imageUrl ?? null })),
      dto.serieIds,
      dto.stockInicial ?? 1,
      dto.stockMinimo ?? 0,
      req.user.tenantId,
    );
    const result = await this.crearProductoHandler.execute(command);
    return { ...result, message: 'Modelo y variantes creados exitosamente' };
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

  @Patch('modelos/:id/toggle')
  @Roles(Rol.ROL_ADMIN)
  async toggleModelo(@Param('id') id: string) {
    const model = await this.prisma.productModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException(`Modelo con ID ${id} no encontrado`);
    const nuevoEstado = !model.active;

    await this.prisma.$transaction([
      this.prisma.productModel.update({
        where: { id },
        data: { active: nuevoEstado },
      }),
      this.prisma.product.updateMany({
        where: { modelId: id },
        data: { active: nuevoEstado },
      }),
    ]);

    return { active: nuevoEstado, message: `Modelo ${nuevoEstado ? 'habilitado' : 'deshabilitado'} exitosamente` };
  }

  @Patch('productos/:id/toggle')
  @Roles(Rol.ROL_ADMIN)
  async toggleProducto(@Param('id') id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    const nuevoEstado = !product.active;

    await this.prisma.product.update({
      where: { id },
      data: { active: nuevoEstado },
    });

    return { active: nuevoEstado, message: `Variante ${nuevoEstado ? 'habilitada' : 'deshabilitada'} exitosamente` };
  }

  @Delete('modelos/:id')
  @Roles(Rol.ROL_ADMIN)
  async eliminarModelo(@Param('id') id: string) {
    const model = await this.prisma.productModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException(`Modelo con ID ${id} no encontrado`);

    await this.prisma.productModel.delete({ where: { id } });

    return { message: `Modelo ${model.name} eliminado permanentemente exitosamente` };
  }
}
