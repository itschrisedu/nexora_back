import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol, EstadoPedido } from '@prisma/client';
import { CrearPedidoDto, CancelarPedidoDto, ModificarEnTransitoDto, ActualizarEstadoPedidoDto } from './dto/pedidos.dto';
import { CrearPedidoHandler } from '../application/commands/CrearPedido.handler';
import { CrearPedidoCommand } from '../application/commands/CrearPedido.command';
import { IniciarPreparacionHandler } from '../application/commands/IniciarPreparacion.handler';
import { IniciarPreparacionCommand } from '../application/commands/IniciarPreparacion.command';
import { MarcarEnTransitoHandler } from '../application/commands/MarcarEnTransito.handler';
import { MarcarEnTransitoCommand } from '../application/commands/MarcarEnTransito.command';
import { CancelarPedidoHandler } from '../application/commands/CancelarPedido.handler';
import { CancelarPedidoCommand } from '../application/commands/CancelarPedido.command';
import { ConfirmarSeparacionBodegaHandler } from '../application/commands/ConfirmarSeparacionBodega.handler';
import { RegistrarModificacionEnTransitoHandler } from '../application/commands/RegistrarModificacionEnTransito.handler';
import { ConfirmarEntregaHandler } from '../application/commands/ConfirmarEntrega.handler';
import { ComercialQueryService } from '../application/queries/ComercialQueryService';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';

// Controlador REST para gestionar operaciones comerciales y pedidos.
@Controller('pedidos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PedidosController {
  constructor(
    private readonly crearPedidoHandler: CrearPedidoHandler,
    private readonly iniciarPreparacionHandler: IniciarPreparacionHandler,
    private readonly marcarEnTransitoHandler: MarcarEnTransitoHandler,
    private readonly cancelarPedidoHandler: CancelarPedidoHandler,
    private readonly confirmarSeparacionHandler: ConfirmarSeparacionBodegaHandler,
    private readonly modificarEnTransitoHandler: RegistrarModificacionEnTransitoHandler,
    private readonly confirmarEntregaHandler: ConfirmarEntregaHandler,
    private readonly queryService: ComercialQueryService,
    private readonly prisma: PrismaService,
  ) {}

  // ══════════════════════════════
  // QUERIES
  // ══════════════════════════════

  @Get()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async buscarPedidos(
    @Req() req: any,
    @Query('clientId') clientId?: string,
    @Query('estado') estado?: EstadoPedido,
  ) {
    if (estado) {
      return this.queryService.obtenerPedidosPorEstado(estado, req.user.tenantId);
    }
    if (clientId) {
      return this.queryService.obtenerPedidosPorCliente(clientId, req.user.tenantId);
    }
    // Si no hay filtros, retornar todos los pedidos del tenant
    return this.queryService.obtenerTodosLosPedidos(req.user.tenantId);
  }

  @Get('cola/pendiente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerPedidosEnCola(@Req() req: any) {
    return this.queryService.obtenerPedidosEnCola(req.user.tenantId);
  }

  @Get(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerPedido(@Param('id') id: string) {
    return this.queryService.obtenerPedido(id);
  }

  // ══════════════════════════════
  // COMMANDS — Fase 4A
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
      req.user.tenantId,
      dto.notas,
    );
    const id = await this.crearPedidoHandler.execute(command);
    return { id, message: 'Pedido creado exitosamente' };
  }

  @Put(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async editarPedido(
    @Param('id') id: string,
    @Body() dto: CrearPedidoDto,
    @Req() req: any,
  ) {
    const pedidoExistente = await this.prisma.order.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!pedidoExistente) {
      throw new NotFoundException(`El pedido con ID "${id}" no existe`);
    }

    if (pedidoExistente.estado === 'ENTREGADO' || pedidoExistente.estado === 'CANCELADO') {
      throw new BadRequestException(`No se puede editar un pedido en estado "${pedidoExistente.estado}"`);
    }

    // 1. Eliminar líneas anteriores
    await this.prisma.orderLine.deleteMany({
      where: { orderId: id },
    });

    // 2. Recrear las líneas y calcular total acumulado
    let montoTotal = 0;
    const nuevasLineasData: any[] = [];

    for (const l of dto.lineas) {
      const prod = await this.prisma.product.findUnique({
        where: { id: l.productId },
      });

      if (!prod) {
        throw new NotFoundException(`El producto con ID "${l.productId}" no existe`);
      }

      const precioUnitario = Number(prod.salePrice);
      const subtotal = precioUnitario * l.cantidad;
      montoTotal += subtotal;

      nuevasLineasData.push({
        orderId: id,
        productId: l.productId,
        tallaId: l.tallaId,
        serieId: prod.serieId || 'DEFAULT_SERIE',
        cantidad: l.cantidad,
        precioUnitario,
        tipoVenta: l.tipoVenta || 'SERIE_COMPLETA',
      });
    }

    if (nuevasLineasData.length > 0) {
      await this.prisma.orderLine.createMany({
        data: nuevasLineasData,
      });
    }

    // 3. Actualizar monto y datos del pedido
    await this.prisma.order.update({
      where: { id },
      data: {
        montoTotal,
        tipoPago: dto.tipoPago || pedidoExistente.tipoPago,
        notas: dto.notas !== undefined ? dto.notas : pedidoExistente.notas,
      },
    });

    return { id, message: 'Pedido actualizado exitosamente', montoTotal };
  }

  @Put(':id/estado')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async actualizarEstadoPedido(
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoPedidoDto,
    @Req() req: any,
  ) {
    const pedido = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${id}" no existe`);
    }

    // Ejecutar lógica según el estado de destino
    switch (dto.estado) {
      case EstadoPedido.EN_PREPARACION:
        try {
          await this.iniciarPreparacionHandler.execute(
            new IniciarPreparacionCommand(id, req.user.rol),
          );
        } catch (e) {
          await this.prisma.order.update({
            where: { id },
            data: { estado: EstadoPedido.EN_PREPARACION },
          });
        }
        break;

      case EstadoPedido.EN_TRANSITO:
        try {
          await this.marcarEnTransitoHandler.execute(
            new MarcarEnTransitoCommand(id),
          );
        } catch (e) {
          await this.prisma.order.update({
            where: { id },
            data: { estado: EstadoPedido.EN_TRANSITO },
          });
        }
        break;

      case EstadoPedido.ENTREGADO:
        try {
          await this.confirmarEntregaHandler.execute({
            pedidoId: id,
            userId: req.user.sub,
          });
        } catch (e) {
          await this.prisma.order.update({
            where: { id },
            data: { estado: EstadoPedido.ENTREGADO },
          });
        }
        break;

      case EstadoPedido.CANCELADO:
        try {
          await this.cancelarPedidoHandler.execute(
            new CancelarPedidoCommand(id, dto.motivo || 'Cancelado por el usuario'),
          );
        } catch (e) {
          await this.prisma.order.update({
            where: { id },
            data: { estado: EstadoPedido.CANCELADO },
          });
        }
        break;

      default:
        await this.prisma.order.update({
          where: { id },
          data: { estado: dto.estado },
        });
        break;
    }

    return { id, estado: dto.estado, message: `Estado del pedido actualizado a ${dto.estado}` };
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

  // ══════════════════════════════
  // COMMANDS — Fase 4B (Despacho, Modificación, Entrega)
  // ══════════════════════════════

  @Post(':id/confirmar-separacion')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async confirmarSeparacion(@Param('id') id: string, @Req() req: any) {
    await this.confirmarSeparacionHandler.execute({
      pedidoId: id,
      userId: req.user.sub,
      rol: req.user.rol,
    });
    return { message: 'Separación de bodega confirmada. Pedido en tránsito.' };
  }

  @Post(':id/modificar-en-transito')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async modificarEnTransito(
    @Param('id') id: string,
    @Body() dto: ModificarEnTransitoDto,
    @Req() req: any,
  ) {
    await this.modificarEnTransitoHandler.execute({
      pedidoId: id,
      lineasRechazadas: dto.lineasRechazadas,
      userId: req.user.sub,
    });
    return { message: 'Modificación registrada correctamente' };
  }

  @Post(':id/confirmar-entrega')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async confirmarEntrega(@Param('id') id: string, @Req() req: any) {
    await this.confirmarEntregaHandler.execute({
      pedidoId: id,
      userId: req.user.sub,
    });
    return { message: 'Pedido entregado exitosamente' };
  }

  // ══════════════════════════════
  // QUERIES — Despacho
  // ══════════════════════════════

  @Get('/despacho/ordenes-pendientes')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async obtenerOrdenesDespachoPendientes() {
    return this.prisma.dispatchOrder.findMany({
      where: { estado: 'PENDIENTE_SEPARACION' },
      include: { lines: true, order: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Consultar el último precio al que se le vendió un producto a un cliente específico.
   * Útil para recordar precios anteriores al crear nuevos pedidos.
   */
  @Get('ultimo-precio')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async obtenerUltimoPrecioCliente(
    @Req() req: any,
    @Query('clientId') clientId: string,
    @Query('productId') productId: string,
  ) {
    if (!clientId || !productId) {
      return { precioAnterior: null };
    }

    const ultimaLinea = await this.prisma.orderLine.findFirst({
      where: {
        productId,
        order: {
          clientId,
          tenantId: req.user.tenantId,
          estado: { not: 'CANCELADO' },
        },
      },
      orderBy: { order: { createdAt: 'desc' } },
      select: {
        precioUnitario: true,
        order: { select: { createdAt: true } },
      },
    });

    return {
      precioAnterior: ultimaLinea ? Number(ultimaLinea.precioUnitario) : null,
      fechaUltimaVenta: ultimaLinea?.order?.createdAt || null,
    };
  }
}
