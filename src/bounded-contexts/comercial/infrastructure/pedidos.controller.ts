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
import {
  CrearPedidoDto,
  CancelarPedidoDto,
  ModificarEnTransitoDto,
  ActualizarEstadoPedidoDto,
  ActualizarEnvioPedidoDto,
  EntregarItemsPedidoDto,
} from './dto/pedidos.dto';
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
import { DescontarStockHandler } from '../../inventario/application/commands/DescontarStock.handler';
import { DescontarStockCommand } from '../../inventario/application/commands/DescontarStock.command';
import { ComercialQueryService } from '../application/queries/ComercialQueryService';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
    private readonly descontarStockHandler: DescontarStockHandler,
    private readonly queryService: ComercialQueryService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
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
      req.user.sub || req.user.id,
      req.user.tenantId,
      dto.notas,
      dto.tipoEntrega,
      dto.asumeFlete,
      dto.costoEnvio,
      dto.guiaEnvio,
      dto.courier,
      dto.direccionEnvio,
      dto.ciudadEnvio,
      dto.adelanto ? Number(dto.adelanto) : 0,
      dto.metodoAdelanto,
      dto.referenciaAdelanto,
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
        adelanto: dto.adelanto !== undefined ? Number(dto.adelanto) : pedidoExistente.adelanto,
        metodoAdelanto: dto.metodoAdelanto !== undefined ? dto.metodoAdelanto : pedidoExistente.metodoAdelanto,
        referenciaAdelanto: dto.referenciaAdelanto !== undefined ? dto.referenciaAdelanto : pedidoExistente.referenciaAdelanto,
        tipoEntrega: dto.tipoEntrega !== undefined ? dto.tipoEntrega : pedidoExistente.tipoEntrega,
        asumeFlete: dto.asumeFlete !== undefined ? dto.asumeFlete : pedidoExistente.asumeFlete,
        costoEnvio: dto.costoEnvio !== undefined ? Number(dto.costoEnvio) : pedidoExistente.costoEnvio,
        guiaEnvio: dto.guiaEnvio !== undefined ? dto.guiaEnvio : pedidoExistente.guiaEnvio,
        courier: dto.courier !== undefined ? dto.courier : pedidoExistente.courier,
        direccionEnvio: dto.direccionEnvio !== undefined ? dto.direccionEnvio : pedidoExistente.direccionEnvio,
        ciudadEnvio: dto.ciudadEnvio !== undefined ? dto.ciudadEnvio : pedidoExistente.ciudadEnvio,
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

  /**
   * Entregar ítems específicos o parciales de un pedido.
   * Valida stock en bodega, descuenta el inventario real, actualiza cantidadEntregada
   * y ajusta el estado a ENTREGADO o ENTREGADO_PARCIAL según corresponda.
   */
  @Post(':id/entregar-items')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async entregarItems(
    @Param('id') id: string,
    @Body() dto: EntregarItemsPedidoDto,
    @Req() req: any,
  ) {
    const pedido = await this.prisma.order.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${id}" no existe`);
    }

    if (pedido.estado === EstadoPedido.CANCELADO || pedido.estado === EstadoPedido.ENTREGADO) {
      throw new BadRequestException(`No se pueden entregar ítems de un pedido en estado ${pedido.estado}`);
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Debe especificar al menos un ítem para entregar');
    }

    const userId = req.user.sub || req.user.id;

    // 1. Validaciones previas de cada línea y existencias
    for (const item of dto.items) {
      const line = pedido.lines.find((l) => l.id === item.lineId);
      if (!line) {
        throw new NotFoundException(`La línea de pedido "${item.lineId}" no pertenece a este pedido`);
      }

      if (item.cantidadAEntregar <= 0) {
        continue;
      }

      const restante = line.cantidad - (line.cantidadEntregada || 0);
      if (item.cantidadAEntregar > restante) {
        throw new BadRequestException(
          `La cantidad a entregar (${item.cantidadAEntregar}) supera los ${restante} pares pendientes de esta línea`,
        );
      }

      const stock = await this.prisma.stockByTalla.findUnique({
        where: {
          productId_tallaId: {
            productId: line.productId,
            tallaId: line.tallaId,
          },
        },
      });

      if (!stock || stock.quantity < item.cantidadAEntregar) {
        throw new BadRequestException(
          `Stock físico insuficiente en bodega. Hay ${stock ? stock.quantity : 0} pares disponibles y se intentan entregar ${item.cantidadAEntregar}`,
        );
      }
    }

    // 2. Ejecutar descuento físico y actualización por ítem
    let totalEntregadoEnEstaTransaccion = 0;
    const lineasEntregadasEnEstaTransaccion: Array<{
      productId: string;
      serieId: string;
      tallaId: string;
      cantidad: number;
      precioUnitario: number;
    }> = [];

    for (const item of dto.items) {
      if (item.cantidadAEntregar <= 0) continue;

      const line = pedido.lines.find((l) => l.id === item.lineId)!;

      // 1. Ajustar y liberar reservas asociadas primero para evitar desbalance en reservedQuantity
      const reservas = await this.prisma.stockReservation.findMany({
        where: {
          referenceId: pedido.id,
          productId: line.productId,
          tallaId: line.tallaId,
          canceled: false,
        },
      });

      let porLiberar = item.cantidadAEntregar;
      for (const res of reservas) {
        if (porLiberar <= 0) break;
        if (res.quantity <= porLiberar) {
          await this.prisma.stockReservation.update({
            where: { id: res.id },
            data: { canceled: true },
          });
          await this.prisma.stockByTalla.update({
            where: {
              productId_tallaId: {
                productId: line.productId,
                tallaId: line.tallaId,
              },
            },
            data: {
              reservedQuantity: { decrement: res.quantity },
            },
          });
          porLiberar -= res.quantity;
        } else {
          await this.prisma.stockReservation.update({
            where: { id: res.id },
            data: { quantity: { decrement: porLiberar } },
          });
          await this.prisma.stockByTalla.update({
            where: {
              productId_tallaId: {
                productId: line.productId,
                tallaId: line.tallaId,
              },
            },
            data: {
              reservedQuantity: { decrement: porLiberar },
            },
          });
          porLiberar = 0;
        }
      }

      // 2. Descontar del inventario físico real
      await this.descontarStockHandler.execute(
        new DescontarStockCommand(
          line.productId,
          line.tallaId,
          item.cantidadAEntregar,
          'ENTREGA_PEDIDO_PARCIAL_O_TOTAL',
          pedido.id,
          userId,
        ),
      );

      // Actualizar cantidad entregada acumulada en la línea
      await this.prisma.orderLine.update({
        where: { id: line.id },
        data: {
          cantidadEntregada: { increment: item.cantidadAEntregar },
        },
      });

      lineasEntregadasEnEstaTransaccion.push({
        productId: line.productId,
        serieId: line.serieId,
        tallaId: line.tallaId,
        cantidad: item.cantidadAEntregar,
        precioUnitario: Number(line.precioUnitario),
      });

      totalEntregadoEnEstaTransaccion += item.cantidadAEntregar;
    }

    if (totalEntregadoEnEstaTransaccion === 0) {
      throw new BadRequestException('No se especificaron cantidades válidas mayores a 0 para entregar');
    }

    const montoEntregadoEnEstaTransaccion = lineasEntregadasEnEstaTransaccion.reduce(
      (acc, l) => acc + l.cantidad * l.precioUnitario,
      0,
    );

    // 3. Evaluar estado global del pedido
    const lineasActualizadas = await this.prisma.orderLine.findMany({
      where: { orderId: pedido.id },
    });

    const todoCompletado = lineasActualizadas.every((l) => (l.cantidadEntregada || 0) >= l.cantidad);
    const algunEntregado = lineasActualizadas.some((l) => (l.cantidadEntregada || 0) > 0);

    let nuevoEstado: EstadoPedido = pedido.estado;
    if (todoCompletado) {
      nuevoEstado = EstadoPedido.ENTREGADO;
      await this.prisma.order.update({
        where: { id: pedido.id },
        data: { estado: EstadoPedido.ENTREGADO },
      });
    } else if (algunEntregado) {
      nuevoEstado = EstadoPedido.ENTREGADO_PARCIAL;
      await this.prisma.order.update({
        where: { id: pedido.id },
        data: { estado: EstadoPedido.ENTREGADO_PARCIAL },
      });
    }

    // 4. Emitir PedidoEntregado para generar Nota de Entrega y Cobro/Deuda en Cartera por el lote entregado
    try {
      this.eventEmitter.emit('PedidoEntregado', {
        pedidoId: pedido.id,
        clientId: pedido.clientId,
        montoFinal: montoEntregadoEnEstaTransaccion,
        lineasEntregadas: lineasEntregadasEnEstaTransaccion,
        tipoPago: pedido.tipoPago,
        canal: pedido.canal,
        yaDescontado: true,
      });
    } catch (e: any) {
      // Registrar log si ocurre excepción en emisión
    }

    const pedidoActualizado = await this.queryService.obtenerPedido(pedido.id);

    return {
      success: true,
      estado: nuevoEstado,
      message: todoCompletado
        ? 'Pedido completado y entregado al 100% con éxito.'
        : `Entrega parcial registrada (${totalEntregadoEnEstaTransaccion} pares entregados). El pedido queda con saldo pendiente.`,
      pedido: pedidoActualizado,
    };
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

  /**
   * Actualizar o cambiar los datos de logística de envío y flete de un pedido (Fase E1).
   * Si la empresa asume el flete y costo > 0, genera o actualiza automáticamente el gasto operativo.
   */
  @Put(':id/envio')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async actualizarEnvioPedido(
    @Param('id') id: string,
    @Body() dto: ActualizarEnvioPedidoDto,
    @Req() req: any,
  ) {
    const userId = req.user.sub || req.user.id;

    const order = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException(`Pedido con ID "${id}" no encontrado`);
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        tipoEntrega: dto.tipoEntrega,
        asumeFlete: dto.asumeFlete || 'NO_APLICA',
        costoEnvio: dto.costoEnvio || 0,
        guiaEnvio: dto.guiaEnvio || null,
        courier: dto.courier || null,
        direccionEnvio: dto.direccionEnvio || null,
        ciudadEnvio: dto.ciudadEnvio || null,
      },
    });

    // Si la empresa asume el flete y costo > 0, crear o actualizar el registro de gasto operativo
    if (dto.asumeFlete === 'EMPRESA' && dto.costoEnvio && Number(dto.costoEnvio) > 0) {
      const gastoExistente = await this.prisma.gasto.findFirst({
        where: { orderId: id, categoria: 'LOGISTICA_ENVIOS' },
      });

      if (gastoExistente) {
        await this.prisma.gasto.update({
          where: { id: gastoExistente.id },
          data: {
            monto: dto.costoEnvio,
            numeroComprobante: dto.guiaEnvio || null,
            proveedorServicio: dto.courier || 'Empresa de Envíos',
            observaciones: `Envío a ${dto.ciudadEnvio || ''} - ${dto.direccionEnvio || ''}`.trim(),
          },
        });
      } else {
        await this.prisma.gasto.create({
          data: {
            tenantId: order.tenantId,
            userId,
            orderId: id,
            categoria: 'LOGISTICA_ENVIOS',
            concepto: `Flete de envío pedido #${id.slice(0, 8)} (${dto.courier || 'Transporte'})`,
            monto: dto.costoEnvio,
            metodoPago: 'EFECTIVO',
            numeroComprobante: dto.guiaEnvio || null,
            proveedorServicio: dto.courier || 'Empresa de Envíos',
            observaciones: `Envío a ${dto.ciudadEnvio || ''} - ${dto.direccionEnvio || ''}`.trim(),
          },
        });
      }
    } else if (dto.asumeFlete !== 'EMPRESA') {
      // Si ya no es asumido por la empresa, eliminar gasto de flete si existía
      await this.prisma.gasto.deleteMany({
        where: { orderId: id, categoria: 'LOGISTICA_ENVIOS' },
      });
    }

    return { success: true, message: 'Logística de envío y flete actualizada', order: updated };
  }
}

