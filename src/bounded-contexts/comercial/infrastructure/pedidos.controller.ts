import {
  Body,
  Controller,
  Delete,
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
import { Rol, EstadoPedido } from '@prisma/client';
import { CrearPedidoDto, CancelarPedidoDto } from './dto/pedidos.dto';
import { CrearPedidoHandler } from '../application/commands/CrearPedido.handler';
import { CrearPedidoCommand } from '../application/commands/CrearPedido.command';
import { IniciarPreparacionHandler } from '../application/commands/IniciarPreparacion.handler';
import { IniciarPreparacionCommand } from '../application/commands/IniciarPreparacion.command';
import { MarcarEnTransitoHandler } from '../application/commands/MarcarEnTransito.handler';
import { MarcarEnTransitoCommand } from '../application/commands/MarcarEnTransito.command';
import { CancelarPedidoHandler } from '../application/commands/CancelarPedido.handler';
import { CancelarPedidoCommand } from '../application/commands/CancelarPedido.command';
import { ComercialQueryService } from '../application/queries/ComercialQueryService';

@Controller('pedidos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PedidosController {
  constructor(
    private readonly crearPedidoHandler: CrearPedidoHandler,
    private readonly iniciarPreparacionHandler: IniciarPreparacionHandler,
    private readonly marcarEnTransitoHandler: MarcarEnTransitoHandler,
    private readonly cancelarPedidoHandler: CancelarPedidoHandler,
    private readonly queryService: ComercialQueryService,
  ) {}

  // ══════════════════════════════
  // QUERIES
  // ══════════════════════════════

  @Get()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async buscarPedidos(
    @Query('clientId') clientId?: string,
    @Query('estado') estado?: EstadoPedido,
  ) {
    if (estado) {
      return this.queryService.obtenerPedidosPorEstado(estado);
    }
    if (clientId) {
      return this.queryService.obtenerPedidosPorCliente(clientId);
    }
    // Si no hay filtros, podemos retornar todos los pendientes por defecto
    return this.queryService.obtenerPedidosPorEstado(EstadoPedido.PENDIENTE);
  }

  @Get('cola/pendiente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerPedidosEnCola() {
    return this.queryService.obtenerPedidosEnCola();
  }

  @Get(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerPedido(@Param('id') id: string) {
    return this.queryService.obtenerPedido(id);
  }

  // ══════════════════════════════
  // COMMANDS
  // ══════════════════════════════

  @Post()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async crearPedido(@Body() dto: CrearPedidoDto, @Req() req: any) {
    const command = new CrearPedidoCommand(
      dto.clientId,
      dto.canal,
      dto.tipoPago,
      dto.lineas,
      req.user.sub,
      dto.notas,
    );
    const id = await this.crearPedidoHandler.execute(command);
    return { id, message: 'Pedido creado exitosamente' };
  }

  @Post(':id/iniciar-preparacion')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async iniciarPreparacion(@Param('id') id: string, @Req() req: any) {
    const command = new IniciarPreparacionCommand(id, req.user.rol);
    await this.iniciarPreparacionHandler.execute(command);
    return { message: 'Preparación de pedido iniciada' };
  }

  @Post(':id/marcar-en-transito')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async marcarEnTransito(@Param('id') id: string) {
    const command = new MarcarEnTransitoCommand(id);
    await this.marcarEnTransitoHandler.execute(command);
    return { message: 'Pedido marcado en tránsito' };
  }

  @Delete(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async cancelarPedido(@Param('id') id: string, @Body() dto: CancelarPedidoDto) {
    const command = new CancelarPedidoCommand(id, dto.motivo);
    await this.cancelarPedidoHandler.execute(command);
    return { message: 'Pedido cancelado con éxito' };
  }
}
