import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Patch,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol, EstadoPedido, MovimientoTipo, CobroEstado } from '@prisma/client';
import {
  CrearPedidoDto,
  CancelarPedidoDto,
  ModificarEnTransitoDto,
  ActualizarEstadoPedidoDto,
  ActualizarEnvioPedidoDto,
  EntregarItemsPedidoDto,
  RevertirEntregaDto,
  RegistrarDevolucionPedidoDto,
  ActualizarAdelantoPedidoDto,
  CorregirPrecioLineaDto,
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
    @Query('incluirOtrasSucursales') incluirOtrasSucursales?: string,
    @Query('sucursalId') sucursalId?: string,
  ) {
    const targetTenantId = sucursalId || (incluirOtrasSucursales === 'true' ? null : req.user.tenantId);
    if (estado) {
      return this.queryService.obtenerPedidosPorEstado(estado, targetTenantId);
    }
    if (clientId) {
      return this.queryService.obtenerPedidosPorCliente(clientId, targetTenantId);
    }
    // Si no hay filtros, retornar todos los pedidos
    return this.queryService.obtenerTodosLosPedidos(targetTenantId);
  }

  @Get('cola/pendiente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerPedidosEnCola(@Req() req: any) {
    return this.queryService.obtenerPedidosEnCola(req.user.tenantId);
  }

  // ══════════════════════════════
  // QUERIES — Despacho
  // ══════════════════════════════

  @Get('despacho/ordenes-pendientes')
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
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerUltimoPrecioCliente(
    @Req() req: any,
    @Query('clientId') clientId: string,
    @Query('productId') productId?: string,
    @Query('modelId') modelId?: string,
    @Query('modelName') modelName?: string,
  ) {
    if (!clientId) {
      return { precioAnterior: null };
    }

    let targetModelName = modelName ? modelName.trim() : '';
    let targetBaseCode = '';

    if (productId && !targetModelName) {
      const prod = await this.prisma.product.findUnique({
        where: { id: productId },
        include: { model: true },
      });
      if (prod?.model) {
        targetModelName = prod.model.name;
        targetBaseCode = prod.model.baseCode;
      }
    } else if (modelId && !targetModelName) {
      const model = await this.prisma.productModel.findUnique({
        where: { id: modelId },
      });
      if (model) {
        targetModelName = model.name;
        targetBaseCode = model.baseCode;
      }
    }

    // 1. Encontrar todos los modelos homólogos en todas las sucursales (por nombre o baseCode)
    const matchingModelFilters: any[] = [];
    if (modelId) matchingModelFilters.push({ id: modelId });
    if (targetModelName) {
      matchingModelFilters.push({
        name: { equals: targetModelName, mode: 'insensitive' },
      });
    }
    if (targetBaseCode) {
      matchingModelFilters.push({
        baseCode: { equals: targetBaseCode, mode: 'insensitive' },
      });
    }

    let allMatchingModelIds: string[] = [];
    if (matchingModelFilters.length > 0) {
      const models = await this.prisma.productModel.findMany({
        where: { OR: matchingModelFilters },
        select: { id: true },
      });
      allMatchingModelIds = models.map((m) => m.id);
    }

    // 2. Encontrar todos los productos asociados a estos modelos en cualquier sucursal
    const productFilters: any[] = [];
    if (allMatchingModelIds.length > 0) {
      productFilters.push({ modelId: { in: allMatchingModelIds } });
    }
    if (productId) {
      productFilters.push({ id: productId });
    }

    let matchingProductIds: string[] = [];
    if (productFilters.length > 0) {
      const prods = await this.prisma.product.findMany({
        where: { OR: productFilters },
        select: { id: true },
      });
      matchingProductIds = prods.map((p) => p.id);
    }

    if (matchingProductIds.length === 0) {
      return { precioAnterior: null };
    }

    // 3. Buscar la última venta en OrderLine (en cualquier sucursal de la empresa)
    const ultimaOrderLine = await this.prisma.orderLine.findFirst({
      where: {
        productId: { in: matchingProductIds },
        order: {
          clientId,
          estado: { not: 'CANCELADO' },
        },
      },
      orderBy: { order: { createdAt: 'desc' } },
      select: {
        precioUnitario: true,
        order: {
          select: {
            createdAt: true,
            tenant: { select: { id: true, name: true } },
          },
        },
      },
    });

    // 4. Buscar también en SaleNoteLine (ventas directas y notas de entrega)
    const ultimaSaleNoteLine: any = await this.prisma.saleNoteLine.findFirst({
      where: {
        productId: { in: matchingProductIds },
        saleNote: {
          clientId,
        },
      },
      orderBy: { saleNote: { createdAt: 'desc' } },
      select: {
        precioUnitario: true,
        saleNote: {
          select: {
            createdAt: true,
            tenant: { select: { id: true, name: true } },
          },
        },
      },
    });

    let precioAnterior: number | null = null;
    let fechaUltimaVenta: Date | null = null;
    let sucursalNombre: string | null = null;
    let sucursalId: string | null = null;

    const fechaOrder = ultimaOrderLine?.order?.createdAt;
    const fechaSaleNote = ultimaSaleNoteLine?.saleNote?.createdAt;

    if (fechaOrder && (!fechaSaleNote || fechaOrder >= fechaSaleNote)) {
      precioAnterior = Number(ultimaOrderLine.precioUnitario);
      fechaUltimaVenta = fechaOrder;
      sucursalNombre = ultimaOrderLine.order?.tenant?.name || null;
      sucursalId = ultimaOrderLine.order?.tenant?.id || null;
    } else if (fechaSaleNote) {
      precioAnterior = Number(ultimaSaleNoteLine.precioUnitario);
      fechaUltimaVenta = fechaSaleNote;
      sucursalNombre = ultimaSaleNoteLine.saleNote?.tenant?.name || null;
      sucursalId = ultimaSaleNoteLine.saleNote?.tenant?.id || null;
    }

    return {
      precioAnterior,
      fechaUltimaVenta,
      sucursalNombre,
      sucursalId,
    };
  }

  // ──────────────────────────────────────────
  // FASE 5.1 — Alternancia Automática de Medias Docenas (Serie A / B)
  // ──────────────────────────────────────────
  @Get('curva-sugerida')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerCurvaSugerida(
    @Query('productId') productId?: string,
    @Query('modelId') modelId?: string,
  ) {
    if (!productId && !modelId) {
      return {
        curvaSugerida: 'MEDIA_A',
        ultimaCurvaUsada: null,
        razon: 'DEFAULT',
        alternada: false,
        stockMediasA: 0,
        stockMediasB: 0,
      };
    }

    // 1. Obtener los IDs de producto vinculados al modelo o producto
    let targetProductIds: string[] = [];
    if (productId) targetProductIds.push(productId);
    if (modelId) {
      const prods = await this.prisma.product.findMany({
        where: { modelId },
        select: { id: true },
      });
      targetProductIds = Array.from(new Set([...targetProductIds, ...prods.map((p) => p.id)]));
    }

    // 2. Buscar las órdenes anteriores no canceladas para detectar la última curva usada
    const ultimasLineas = await this.prisma.orderLine.findMany({
      where: {
        productId: { in: targetProductIds },
        order: { estado: { not: 'CANCELADO' } },
      },
      orderBy: { order: { createdAt: 'desc' } },
      take: 20,
      include: {
        order: { select: { id: true, createdAt: true } },
      },
    });

    let ultimaCurvaUsada: 'MEDIA_A' | 'MEDIA_B' | null = null;
    if (ultimasLineas.length > 0) {
      const ultimoOrderId = ultimasLineas[0].orderId;
      const lineasUltimaOrden = ultimasLineas.filter((l) => l.orderId === ultimoOrderId);

      const tallasIds = lineasUltimaOrden.map((l) => l.tallaId);
      const tallasConfig = await this.prisma.tallaConfig.findMany({
        where: { id: { in: tallasIds } },
      });
      const tallaMap = new Map(tallasConfig.map((t) => [t.id, t.numero]));

      let cant39 = 0;
      let cant40 = 0;
      for (const l of lineasUltimaOrden) {
        const num = tallaMap.get(l.tallaId);
        if (num === 39 || num === 35) cant39 += l.cantidad;
        if (num === 40 || num === 36) cant40 += l.cantidad;
      }

      if (cant39 > cant40) {
        ultimaCurvaUsada = 'MEDIA_A';
      } else if (cant40 > cant39) {
        ultimaCurvaUsada = 'MEDIA_B';
      }
    }

    // 3. Determinar la curva alterna
    const curvaAlterna: 'MEDIA_A' | 'MEDIA_B' = ultimaCurvaUsada === 'MEDIA_A' ? 'MEDIA_B' : 'MEDIA_A';

    // 4. Evaluar el stock disponible en bodega para ambas curvas
    let stockA = 999;
    let stockB = 999;
    const targetProdId = productId || (targetProductIds.length > 0 ? targetProductIds[0] : null);

    if (targetProdId) {
      const prod = await this.prisma.product.findUnique({
        where: { id: targetProdId },
        include: {
          stockByTalla: { include: { talla: true } },
        },
      });

      if (prod && prod.stockByTalla && prod.stockByTalla.length > 0) {
        for (const s of prod.stockByTalla) {
          const num = s.talla?.numero;
          const disp = Math.max(0, s.quantity - s.reservedQuantity);
          if (num === 39) {
            stockA = Math.min(stockA, Math.floor(disp / 2));
            stockB = Math.min(stockB, disp);
          } else if (num === 40) {
            stockA = Math.min(stockA, disp);
            stockB = Math.min(stockB, Math.floor(disp / 2));
          } else if (num !== undefined) {
            stockA = Math.min(stockA, disp);
            stockB = Math.min(stockB, disp);
          }
        }
      }
    }

    const tieneStockA = stockA > 0 && stockA !== 999;
    const tieneStockB = stockB > 0 && stockB !== 999;

    let curvaSugerida: 'MEDIA_A' | 'MEDIA_B' = curvaAlterna;
    let razon = 'ALTERNANCIA';
    let alternada = Boolean(ultimaCurvaUsada);

    if (curvaAlterna === 'MEDIA_A' && !tieneStockA && tieneStockB) {
      curvaSugerida = 'MEDIA_B';
      razon = 'STOCK_DISPONIBLE';
      alternada = false;
    } else if (curvaAlterna === 'MEDIA_B' && !tieneStockB && tieneStockA) {
      curvaSugerida = 'MEDIA_A';
      razon = 'STOCK_DISPONIBLE';
      alternada = false;
    } else if (!tieneStockA && !tieneStockB) {
      curvaSugerida = curvaAlterna;
      razon = 'SIN_STOCK';
      alternada = Boolean(ultimaCurvaUsada);
    }

    return {
      curvaSugerida,
      ultimaCurvaUsada,
      razon,
      alternada,
      stockMediasA: stockA === 999 ? 0 : stockA,
      stockMediasB: stockB === 999 ? 0 : stockB,
    };
  }

  // La ruta dinámica :id DEBE ir después de todas las rutas estáticas GET
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
    const targetTenantId = dto.sucursalId || req.user.tenantId;
    const command = new CrearPedidoCommand(
      dto.clientId,
      dto.canal,
      dto.tipoPago,
      dto.lineas,
      req.user.sub || req.user.id,
      targetTenantId,
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

    // 0. Liberar y cancelar reservas previas de inventario asociadas a este pedido
    const reservasPrevias = await this.prisma.stockReservation.findMany({
      where: { referenceId: id, canceled: false },
    });
    for (const res of reservasPrevias) {
      await this.prisma.stockReservation.update({
        where: { id: res.id },
        data: { canceled: true },
      });
      await this.prisma.stockByTalla.updateMany({
        where: { productId: res.productId, tallaId: res.tallaId },
        data: { reservedQuantity: { decrement: res.quantity } },
      });
    }

    // 1. Eliminar líneas anteriores de la base de datos
    await this.prisma.orderLine.deleteMany({
      where: { orderId: id },
    });

    // 2. Recrear exclusivamente las líneas que realmente quedaron en el pedido
    let montoTotal = 0;
    const nuevasLineasData: any[] = [];
    let tieneStockParaTodo = true;

    for (const l of dto.lineas) {
      if (Number(l.cantidad) <= 0) continue;

      const prod = await this.prisma.product.findUnique({
        where: { id: l.productId },
        include: { stockByTalla: true },
      });

      if (!prod) {
        throw new NotFoundException(`El producto con ID "${l.productId}" no existe`);
      }

      // Evaluar stock disponible para esta talla
      const stockItem = prod.stockByTalla?.find((s) => s.tallaId === l.tallaId);
      const stockDisp = stockItem ? (stockItem.quantity - stockItem.reservedQuantity) : 0;
      if (stockDisp < l.cantidad) {
        tieneStockParaTodo = false;
      }

      // Preservar si esta línea ya tenía entregas previas en este pedido
      const lineaPrevia = pedidoExistente.lines.find(
        (pl) => pl.productId === l.productId && pl.tallaId === l.tallaId,
      );
      const cantEntregadaPrevia = lineaPrevia ? (lineaPrevia.cantidadEntregada || 0) : 0;
      const cantEntregada = Math.min(cantEntregadaPrevia, l.cantidad);

      const precioUnitario = (l.precioUnitario !== undefined && l.precioUnitario !== null && Number(l.precioUnitario) > 0)
        ? Number(l.precioUnitario)
        : Number(prod.salePrice);
      const subtotal = precioUnitario * l.cantidad;
      montoTotal += subtotal;

      nuevasLineasData.push({
        orderId: id,
        productId: l.productId,
        tallaId: l.tallaId,
        serieId: l.serieId || prod.serieId || 'DEFAULT_SERIE',
        cantidad: l.cantidad,
        cantidadEntregada: cantEntregada,
        precioUnitario,
        tipoVenta: l.tipoVenta || 'SERIE_COMPLETA',
      });
    }

    if (nuevasLineasData.length > 0) {
      await this.prisma.orderLine.createMany({
        data: nuevasLineasData,
      });
    }

    // 3. Determinar nuevo estado exacto según las entregas y stock disponible
    const todoEntregado = nuevasLineasData.length > 0 && nuevasLineasData.every((l) => (l.cantidadEntregada || 0) >= l.cantidad);
    const algunEntregado = nuevasLineasData.some((l) => (l.cantidadEntregada || 0) > 0);

    let nuevoEstado: EstadoPedido;
    if (todoEntregado) {
      nuevoEstado = EstadoPedido.ENTREGADO;
    } else if (algunEntregado) {
      nuevoEstado = EstadoPedido.ENTREGADO_PARCIAL;
    } else if (pedidoExistente.estado === EstadoPedido.EN_PREPARACION) {
      nuevoEstado = EstadoPedido.EN_PREPARACION;
    } else {
      nuevoEstado = tieneStockParaTodo ? EstadoPedido.PENDIENTE : EstadoPedido.EN_ESPERA_STOCK;
    }

    // Desactivar cola de espera si el pedido ahora tiene stock completo
    if (tieneStockParaTodo) {
      await this.prisma.orderQueue.updateMany({
        where: { orderId: id, activa: true },
        data: { activa: false, activadaAt: new Date() },
      });
    }

    // 4. Actualizar monto y datos del pedido
    await this.prisma.order.update({
      where: { id },
      data: {
        montoTotal: Math.round(montoTotal * 100) / 100,
        estado: nuevoEstado,
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

    return {
      id,
      message: 'Pedido actualizado exitosamente con las líneas definitivas',
      montoTotal: Math.round(montoTotal * 100) / 100,
      estado: nuevoEstado,
    };
  }

  @Put(':id/adelanto')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async actualizarAdelantoPedido(
    @Param('id') id: string,
    @Body() dto: ActualizarAdelantoPedidoDto,
    @Req() req: any,
  ) {
    const pedidoExistente = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!pedidoExistente) {
      throw new NotFoundException(`El pedido con ID "${id}" no existe`);
    }

    if (pedidoExistente.estado === 'ENTREGADO' || pedidoExistente.estado === 'CANCELADO') {
      throw new BadRequestException(`No se puede modificar el anticipo de un pedido en estado "${pedidoExistente.estado}"`);
    }

    const adelanto = Math.max(0, Number(dto.adelanto || 0));
    const metodoAdelanto = adelanto > 0 ? (dto.metodoAdelanto || 'EFECTIVO') : null;
    const referenciaAdelanto = adelanto > 0 ? (dto.referenciaAdelanto || null) : null;

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        adelanto,
        metodoAdelanto,
        referenciaAdelanto,
      },
    });

    return {
      id,
      message: 'Anticipo/Adelanto actualizado exitosamente',
      adelanto: Number(updated.adelanto),
      metodoAdelanto: updated.metodoAdelanto,
      referenciaAdelanto: updated.referenciaAdelanto,
    };
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

    const userRole = req.user?.rol || req.user?.role;
    const userTenant = req.user?.tenantId;
    if (dto.estado === EstadoPedido.ENTREGADO && userRole !== Rol.ROL_SUPER_ADMIN && userTenant && pedido.tenantId && pedido.tenantId !== userTenant) {
      throw new ForbiddenException('Solo la sucursal que posee el pedido puede registrar la entrega física de la mercadería');
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
        } catch (e: any) {
          console.error(`[PedidosController] Error al ejecutar CancelarPedidoHandler para pedido ${id}:`, e?.message || e);
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
    const pedido = await this.prisma.order.findUnique({ where: { id } });
    if (!pedido) throw new NotFoundException(`El pedido con ID "${id}" no existe`);
    const userRole = req.user?.rol || req.user?.role;
    const userTenant = req.user?.tenantId;
    if (userRole !== Rol.ROL_SUPER_ADMIN && userTenant && pedido.tenantId && pedido.tenantId !== userTenant) {
      throw new ForbiddenException('Solo la sucursal que posee el pedido puede registrar la entrega física de la mercadería');
    }

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

    const userRole = req.user?.rol || req.user?.role;
    const userTenant = req.user?.tenantId;
    if (userRole !== Rol.ROL_SUPER_ADMIN && userTenant && pedido.tenantId && pedido.tenantId !== userTenant) {
      throw new ForbiddenException('Solo la sucursal que posee el pedido puede registrar la entrega física de la mercadería');
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

      const effectiveTallaId = (item.tallaIdSustituta && item.tallaIdSustituta.trim() !== '' && item.tallaIdSustituta !== line.tallaId)
        ? item.tallaIdSustituta
        : line.tallaId;

      const stock = await this.prisma.stockByTalla.findUnique({
        where: {
          productId_tallaId: {
            productId: line.productId,
            tallaId: effectiveTallaId,
          },
        },
      });

      if (!stock || stock.quantity < item.cantidadAEntregar) {
        const tallaObj = await this.prisma.tallaConfig.findUnique({ where: { id: effectiveTallaId } });
        const tallaStr = tallaObj ? `Talla ${tallaObj.numero}` : 'la talla seleccionada';
        throw new BadRequestException(
          `Stock físico insuficiente en bodega para ${tallaStr}. Hay ${stock ? stock.quantity : 0} pares disponibles y se intentan entregar ${item.cantidadAEntregar}`,
        );
      }
    }

    // 2. Validar límite de crédito del cliente si la entrega es a CRÉDITO
    if (pedido.tipoPago === 'CREDITO') {
      const client = await this.prisma.client.findUnique({
        where: { id: pedido.clientId },
      });
      if (client) {
        const limiteTotal = Number(client.limiteCredito);
        const cobrosPendientes = await this.prisma.cobro.findMany({
          where: {
            clientId: pedido.clientId,
            estado: { in: ['PENDIENTE', 'PARCIALMENTE_PAGADO'] },
          },
          select: { saldoPendiente: true },
        });
        const saldoActual = Math.max(0, cobrosPendientes.reduce((sum, c) => sum + Number(c.saldoPendiente), 0) - Number(client.saldoAFavor || 0));

        let montoDespacho = 0;
        for (const item of dto.items) {
          if (item.cantidadAEntregar <= 0) continue;
          const line = pedido.lines.find((l) => l.id === item.lineId);
          if (line) {
            const precioUnit = (item.precioUnitario !== undefined && item.precioUnitario !== null && Number(item.precioUnitario) > 0)
              ? Number(item.precioUnitario)
              : Number(line.precioUnitario);
            montoDespacho += item.cantidadAEntregar * precioUnit;
          }
        }

        if (limiteTotal <= 0) {
          throw new BadRequestException(
            'No se puede despachar a crédito: el cliente no posee cupo de crédito aprobado (Límite: $0.00). Debe cobrar de contado o asignar cupo.',
          );
        }

        if (saldoActual + montoDespacho > limiteTotal) {
          const saldoProyectado = saldoActual + montoDespacho;
          throw new BadRequestException(
            `No se puede despachar: este cliente tiene un cupo máximo de $${limiteTotal.toFixed(2)} y su saldo alcanzaría $${saldoProyectado.toFixed(2)} tras esta entrega ($${saldoActual.toFixed(2)} actual + $${montoDespacho.toFixed(2)} despacho). Registre un abono previo para proceder.`,
          );
        }
      }
    }

    // 3. Ejecutar descuento físico y actualización por ítem
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
        const cantALiberar = Math.min(porLiberar, res.quantity);

        if (cantALiberar >= res.quantity) {
          await this.prisma.stockReservation.update({
            where: { id: res.id },
            data: { canceled: true },
          });
        } else {
          await this.prisma.stockReservation.update({
            where: { id: res.id },
            data: { quantity: { decrement: cantALiberar } },
          });
        }

        // Obtener el stock actual y asegurar que NUNCA sea decrementado a valores negativos
        const currentStock = await this.prisma.stockByTalla.findUnique({
          where: {
            productId_tallaId: {
              productId: line.productId,
              tallaId: line.tallaId,
            },
          },
        });

        if (currentStock) {
          const nuevaReserva = Math.max(0, (currentStock.reservedQuantity || 0) - cantALiberar);
          await this.prisma.stockByTalla.update({
            where: { id: currentStock.id },
            data: { reservedQuantity: nuevaReserva },
          });
        }

        porLiberar -= cantALiberar;
      }

      // 2. Descontar del inventario físico real (talla física entregada)
      const effectiveTallaId = (item.tallaIdSustituta && item.tallaIdSustituta.trim() !== '' && item.tallaIdSustituta !== line.tallaId)
        ? item.tallaIdSustituta
        : line.tallaId;

      const isSustituta = effectiveTallaId !== line.tallaId;
      let sustitucionNota = '';
      if (isSustituta) {
        const [tOrig, tSust] = await Promise.all([
          this.prisma.tallaConfig.findUnique({ where: { id: line.tallaId } }),
          this.prisma.tallaConfig.findUnique({ where: { id: effectiveTallaId } }),
        ]);
        const numOrig = tOrig ? `T${tOrig.numero}` : line.tallaId;
        const numSust = tSust ? `T${tSust.numero}` : effectiveTallaId;
        sustitucionNota = `[Despacho compensatorio: ${item.cantidadAEntregar} par(es) ${numSust} entregados en sustitución de ${numOrig}]`;
        
        // Registrar en notas del pedido para trazabilidad permanente
        const pedidoActual = await this.prisma.order.findUnique({ where: { id: pedido.id }, select: { notas: true } });
        const notasActualizadas = pedidoActual?.notas ? `${pedidoActual.notas} | ${sustitucionNota}` : sustitucionNota;
        await this.prisma.order.update({
          where: { id: pedido.id },
          data: { notas: notasActualizadas },
        });
      }

      await this.descontarStockHandler.execute(
        new DescontarStockCommand(
          line.productId,
          effectiveTallaId,
          item.cantidadAEntregar,
          isSustituta ? `ENTREGA_PEDIDO_SUSTITUCION (${sustitucionNota})` : 'ENTREGA_PEDIDO_PARCIAL_O_TOTAL',
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

      // Si se especificó un nuevo precio acordado para la entrega, actualizar la línea
      const precioEfectivo = (item.precioUnitario !== undefined && item.precioUnitario !== null && Number(item.precioUnitario) > 0)
        ? Number(item.precioUnitario)
        : Number(line.precioUnitario);

      if (precioEfectivo !== Number(line.precioUnitario)) {
        await this.prisma.orderLine.update({
          where: { id: line.id },
          data: { precioUnitario: precioEfectivo },
        });
      }

      lineasEntregadasEnEstaTransaccion.push({
        productId: line.productId,
        serieId: line.serieId,
        tallaId: effectiveTallaId,
        cantidad: item.cantidadAEntregar,
        precioUnitario: precioEfectivo,
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

    // 3. Evaluar estado global del pedido y actualizar monto total recalculado
    const lineasActualizadas = await this.prisma.orderLine.findMany({
      where: { orderId: pedido.id },
    });

    const nuevoMontoTotalCalculado = lineasActualizadas.reduce(
      (acc, l) => acc + (Number(l.precioUnitario) * l.cantidad),
      0,
    );

    const todoCompletado = lineasActualizadas.every((l) => (l.cantidadEntregada || 0) >= l.cantidad);
    const algunEntregado = lineasActualizadas.some((l) => (l.cantidadEntregada || 0) > 0);

    let nuevoEstado: EstadoPedido = pedido.estado;
    if (todoCompletado) {
      nuevoEstado = EstadoPedido.ENTREGADO;
      await this.prisma.order.update({
        where: { id: pedido.id },
        data: {
          estado: EstadoPedido.ENTREGADO,
          montoTotal: nuevoMontoTotalCalculado,
        },
      });
    } else if (algunEntregado) {
      nuevoEstado = EstadoPedido.ENTREGADO_PARCIAL;
      await this.prisma.order.update({
        where: { id: pedido.id },
        data: {
          estado: EstadoPedido.ENTREGADO_PARCIAL,
          montoTotal: nuevoMontoTotalCalculado,
        },
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

  /**
   * Endpoint para corregir o revertir una entrega errónea de ítems de un pedido.
   * Restituye el inventario físico (StockByTalla y StockMovement), reduce cantidadEntregada,
   * reevalúa el estado del pedido (PENDIENTE, ENTREGADO_PARCIAL, ENTREGADO),
   * descuenta el saldo pendiente en Cobro y recalcula el crédito utilizado del cliente.
   */
  @Put(':id/revertir-entrega')
  @Post(':id/revertir-entrega')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async revertirEntrega(
    @Param('id') id: string,
    @Body() dto: RevertirEntregaDto,
    @Req() req: any,
  ) {
    const pedido = await this.prisma.order.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${id}" no existe`);
    }

    const userRole = req.user?.rol || req.user?.role;
    const userTenant = req.user?.tenantId;
    if (userRole !== Rol.ROL_SUPER_ADMIN && userTenant && pedido.tenantId && pedido.tenantId !== userTenant) {
      throw new ForbiddenException('Solo la sucursal propietaria del pedido puede revertir o corregir entregas');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Debe especificar al menos un ítem para revertir');
    }

    const userId = req.user?.sub || req.user?.id || pedido.userId || 'system';

    // 1. Validaciones previas de cantidades
    let totalParesARevertir = 0;
    let montoTotalRevertido = 0;

    for (const item of dto.items) {
      if (item.cantidadARevertir <= 0) continue;
      const line = pedido.lines.find((l) => l.id === item.lineId);
      if (!line) {
        throw new NotFoundException(`La línea "${item.lineId}" no pertenece a este pedido`);
      }

      const yaEntregado = (line.cantidadEntregada !== null && line.cantidadEntregada !== undefined && line.cantidadEntregada > 0)
        ? line.cantidadEntregada
        : (pedido.estado === EstadoPedido.ENTREGADO ? line.cantidad : 0);

      if (item.cantidadARevertir > yaEntregado) {
        throw new BadRequestException(
          `No se pueden revertir ${item.cantidadARevertir} pares de la línea seleccionada: solo hay ${yaEntregado} pares entregados registrados.`,
        );
      }

      totalParesARevertir += item.cantidadARevertir;
      montoTotalRevertido += item.cantidadARevertir * Number(line.precioUnitario);
    }

    if (totalParesARevertir === 0) {
      throw new BadRequestException('No se especificaron cantidades válidas mayores a 0 para revertir');
    }

    // 2. Ejecutar reversión física en inventario y en las líneas del pedido
    for (const item of dto.items) {
      if (item.cantidadARevertir <= 0) continue;
      const line = pedido.lines.find((l) => l.id === item.lineId)!;
      const yaEntregado = (line.cantidadEntregada !== null && line.cantidadEntregada !== undefined && line.cantidadEntregada > 0)
        ? line.cantidadEntregada
        : (pedido.estado === EstadoPedido.ENTREGADO ? line.cantidad : 0);
      const nuevaCantEntregada = Math.max(0, yaEntregado - item.cantidadARevertir);

      // Decrementar cantidad entregada en la línea
      await this.prisma.orderLine.update({
        where: { id: line.id },
        data: {
          cantidadEntregada: nuevaCantEntregada,
        },
      });

      // Incrementar stock físico en bodega
      await this.prisma.stockByTalla.updateMany({
        where: {
          productId: line.productId,
          tallaId: line.tallaId,
        },
        data: {
          quantity: { increment: item.cantidadARevertir },
        },
      });

      // Registrar movimiento de auditoría en inventario
      await this.prisma.stockMovement.create({
        data: {
          productId: line.productId,
          tallaId: line.tallaId,
          type: MovimientoTipo.AJUSTE,
          quantity: item.cantidadARevertir,
          reason: `Reversión/Corrección de entrega Pedido #${pedido.id.slice(0, 8)}: ${dto.motivo || 'Error de despacho o restitución de mercadería'}`,
          referenceId: pedido.id,
          userId,
        },
      });
    }

    // 3. Ajuste financiero (Cobros y Cuenta Corriente del Cliente)
    const cobrosDelPedido = await this.prisma.cobro.findMany({
      where: { saleNote: { orderId: pedido.id } },
      orderBy: { createdAt: 'desc' },
      include: { abonos: true, saleNote: true },
    });

    let remanenteAReducir = Math.round(montoTotalRevertido * 100) / 100;
    for (const cobro of cobrosDelPedido) {
      if (remanenteAReducir <= 0) break;
      const saldoPend = Number(cobro.saldoPendiente || 0);
      if (saldoPend > 0) {
        const reduccion = Math.min(remanenteAReducir, saldoPend);
        const nuevoSaldo = Math.round((saldoPend - reduccion) * 100) / 100;
        const nuevoEstadoCobro = nuevoSaldo === 0 ? CobroEstado.SALDADO : CobroEstado.PARCIALMENTE_PAGADO;

        await this.prisma.cobro.update({
          where: { id: cobro.id },
          data: {
            saldoPendiente: nuevoSaldo,
            estado: nuevoEstadoCobro,
          },
        });

        // Registrar abono de ajuste para trazabilidad exacta en el historial financiero
        await this.prisma.cobroAbono.create({
          data: {
            cobroId: cobro.id,
            monto: reduccion,
            metodo: 'AJUSTE',
            notas: `Reversión de entrega errónea (-$${reduccion.toFixed(2)}): ${dto.motivo || 'Restitución de pares entregados por error'}`,
            userId,
          },
        });

        remanenteAReducir = Math.round((remanenteAReducir - reduccion) * 100) / 100;
      }
    }

    // Si aún queda remanente a descontar (ej. cobro generado sin saleNote directo), descontar en otros cobros pendientes del cliente
    if (remanenteAReducir > 0) {
      const otrosCobrosPendientes = await this.prisma.cobro.findMany({
        where: {
          clientId: pedido.clientId,
          saldoPendiente: { gt: 0 },
        },
        orderBy: { createdAt: 'desc' },
      });

      for (const cobro of otrosCobrosPendientes) {
        if (remanenteAReducir <= 0) break;
        const saldoPend = Number(cobro.saldoPendiente || 0);
        if (saldoPend > 0) {
          const reduccion = Math.min(remanenteAReducir, saldoPend);
          const nuevoSaldo = Math.round((saldoPend - reduccion) * 100) / 100;
          const nuevoEstadoCobro = nuevoSaldo === 0 ? CobroEstado.SALDADO : CobroEstado.PARCIALMENTE_PAGADO;

          await this.prisma.cobro.update({
            where: { id: cobro.id },
            data: {
              saldoPendiente: nuevoSaldo,
              estado: nuevoEstadoCobro,
            },
          });

          await this.prisma.cobroAbono.create({
            data: {
              cobroId: cobro.id,
              monto: reduccion,
              metodo: 'AJUSTE',
              notas: `Reversión de entrega errónea Pedido #${pedido.id.slice(0, 8)} (-$${reduccion.toFixed(2)})`,
              userId,
            },
          });

          remanenteAReducir = Math.round((remanenteAReducir - reduccion) * 100) / 100;
        }
      }
    }

    // Recalcular crédito utilizado del cliente
    const todosCobrosPendientes = await this.prisma.cobro.findMany({
      where: { clientId: pedido.clientId, estado: { in: [CobroEstado.PENDIENTE, CobroEstado.PARCIALMENTE_PAGADO] } },
      select: { saldoPendiente: true },
    });
    const sumaDeuda = todosCobrosPendientes.reduce((acc, c) => acc + Number(c.saldoPendiente), 0);
    await this.prisma.client.update({
      where: { id: pedido.clientId },
      data: { creditoUtilizado: Math.max(0, Math.round(sumaDeuda * 100) / 100) },
    });

    // 4. Reevaluar estado global del pedido
    const lineasActualizadas = await this.prisma.orderLine.findMany({
      where: { orderId: pedido.id },
    });
    const todoEntregado = lineasActualizadas.every((l) => (l.cantidadEntregada || 0) >= l.cantidad);
    const algunEntregado = lineasActualizadas.some((l) => (l.cantidadEntregada || 0) > 0);

    let nuevoEstado: EstadoPedido;
    if (todoEntregado) {
      nuevoEstado = EstadoPedido.ENTREGADO;
    } else if (algunEntregado) {
      nuevoEstado = EstadoPedido.ENTREGADO_PARCIAL;
    } else {
      nuevoEstado = EstadoPedido.PENDIENTE;
    }

    await this.prisma.order.update({
      where: { id: pedido.id },
      data: { estado: nuevoEstado },
    });

    const pedidoActualizado = await this.queryService.obtenerPedido(pedido.id);

    return {
      success: true,
      estado: nuevoEstado,
      message: `Se revirtieron ${totalParesARevertir} pares correctamente. El calzado ha regresado a bodega y la deuda del cliente fue reducida en $${montoTotalRevertido.toFixed(2)}.`,
      pedido: pedidoActualizado,
    };
  }

  /**
   * Endpoint para registrar una devolución formal de mercadería de un pedido (Fase 3).
   * Valida anti-duplicados (cantidadDevuelta + previas <= entregadas).
   * Restituye stock vendible si destinoStock === 'REINGRESO_INVENTARIO' o lo manda a baja por falla.
   * Crea el registro formal ClienteDevolucion y ClienteDevolucionLinea.
   * Descuenta deuda del cliente en Cobro / SaleNote, genera saldo a favor si aplica,
   * y reduce el crédito utilizado del cliente.
   */
  @Post(':id/devolucion')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async registrarDevolucionPedido(
    @Param('id') id: string,
    @Body() dto: RegistrarDevolucionPedidoDto,
    @Req() req: any,
  ) {
    const pedido = await this.prisma.order.findUnique({
      where: { id },
      include: {
        lines: true,
      },
    });

    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${id}" no existe`);
    }

    const userRole = req.user?.rol || req.user?.role;
    const userTenant = req.user?.tenantId;
    if (userRole !== Rol.ROL_SUPER_ADMIN && userTenant && pedido.tenantId && pedido.tenantId !== userTenant) {
      throw new ForbiddenException('Solo la sucursal propietaria del pedido puede registrar devoluciones');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Debe especificar al menos un ítem para devolver');
    }

    const destinoStock = dto.destinoStock || 'REINGRESO_INVENTARIO';
    const userId = req.user?.sub || req.user?.id || pedido.userId || 'system';

    // 1. Obtener todas las devoluciones previas de este pedido para validación anti-duplicados
    const prevDevoluciones = await this.prisma.clienteDevolucion.findMany({
      where: { orderId: pedido.id },
      include: { lines: true },
    });

    const yaDevueltoMap = new Map<string, number>();
    for (const dev of prevDevoluciones) {
      for (const dl of dev.lines) {
        const key = `${dl.productId}-${dl.tallaId}`;
        yaDevueltoMap.set(key, (yaDevueltoMap.get(key) || 0) + dl.cantidad);
      }
    }

    // 2. Validar cada ítem del DTO contra las líneas del pedido
    let totalParesADevolver = 0;
    let montoTotalDevuelto = 0;
    const lineasAProcesar: {
      line: any;
      cantidadADevolver: number;
      subtotal: number;
    }[] = [];

    const payloadAcumuladoMap = new Map<string, number>();

    for (const item of dto.items) {
      if (item.cantidadADevolver <= 0) continue;

      const line = pedido.lines.find((l) => l.id === item.lineId);
      if (!line) {
        throw new NotFoundException(`La línea de pedido con ID "${item.lineId}" no pertenece a este pedido`);
      }

      const yaEntregado = line.cantidadEntregada || 0;
      if (yaEntregado <= 0) {
        throw new BadRequestException(
          `La línea seleccionada no tiene pares entregados registrados. No es posible procesar una devolución.`,
        );
      }

      const prodKey = `${line.productId}-${line.tallaId}`;
      const previoDevuelto = yaDevueltoMap.get(prodKey) || 0;
      const enEstePayload = payloadAcumuladoMap.get(prodKey) || 0;
      const totalDevolviendo = previoDevuelto + enEstePayload + item.cantidadADevolver;

      if (totalDevolviendo > yaEntregado) {
        const disponible = Math.max(0, yaEntregado - previoDevuelto - enEstePayload);
        throw new BadRequestException(
          `No es posible devolver ${item.cantidadADevolver} pares del calzado seleccionado: solo hay ${disponible} pares disponibles para devolución (${yaEntregado} entregados, ${previoDevuelto} devueltos anteriormente).`,
        );
      }

      payloadAcumuladoMap.set(prodKey, enEstePayload + item.cantidadADevolver);
      totalParesADevolver += item.cantidadADevolver;
      const subtotalLinea = item.cantidadADevolver * Number(line.precioUnitario);
      montoTotalDevuelto += subtotalLinea;

      lineasAProcesar.push({
        line,
        cantidadADevolver: item.cantidadADevolver,
        subtotal: subtotalLinea,
      });
    }

    if (totalParesADevolver === 0) {
      throw new BadRequestException('No se especificaron cantidades válidas mayores a 0 para devolver');
    }

    // 3. Ejecutar transacción atómica de devolución
    const resultadoTransaccion = await this.prisma.$transaction(async (tx) => {
      // A. Manejo de Stock físico
      if (destinoStock === 'REINGRESO_INVENTARIO') {
        for (const item of lineasAProcesar) {
          const stockTalla = await tx.stockByTalla.findFirst({
            where: { productId: item.line.productId, tallaId: item.line.tallaId },
          });

          if (stockTalla) {
            await tx.stockByTalla.update({
              where: { id: stockTalla.id },
              data: { quantity: { increment: item.cantidadADevolver } },
            });
          }

          await tx.stockMovement.create({
            data: {
              productId: item.line.productId,
              tallaId: item.line.tallaId,
              type: MovimientoTipo.AJUSTE,
              quantity: item.cantidadADevolver,
              reason: `Devolución de cliente: ${dto.motivo} (Pedido #${pedido.id.slice(0, 8)})`,
              referenceId: pedido.id,
              userId,
            },
          });
        }
      }

      // B. Ajuste de Cartera / Cobro del Pedido y FIFO de Deuda
      let montoRestante = montoTotalDevuelto;
      let deudaDescontadaTotal = 0;

      const saleNote = await tx.saleNote.findFirst({
        where: { orderId: pedido.id },
        include: { cobro: true },
      });

      const cobrosPendientes = await tx.cobro.findMany({
        where: {
          clientId: pedido.clientId,
          tenantId: pedido.tenantId,
          saldoPendiente: { gt: 0 },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Si el cobro del pedido existe y está pendiente, priorizarlo al frente
      if (saleNote?.cobro && cobrosPendientes.some((c) => c.id === saleNote.cobro!.id)) {
        const idx = cobrosPendientes.findIndex((c) => c.id === saleNote.cobro!.id);
        if (idx > -1) {
          const [cobroPed] = cobrosPendientes.splice(idx, 1);
          cobrosPendientes.unshift(cobroPed);
        }
      }

      for (const cobro of cobrosPendientes) {
        if (montoRestante <= 0) break;
        const saldoActual = Number(cobro.saldoPendiente);
        const descuento = Math.min(montoRestante, saldoActual);

        const nuevoSaldo = Math.max(0, Math.round((saldoActual - descuento) * 100) / 100);
        const nuevoMonto = Math.max(0, Math.round((Number(cobro.montoTotal) - descuento) * 100) / 100);
        const nuevoEstado = nuevoSaldo === 0 ? CobroEstado.SALDADO : cobro.estado;

        await tx.cobro.update({
          where: { id: cobro.id },
          data: {
            saldoPendiente: nuevoSaldo,
            montoTotal: nuevoMonto,
            estado: nuevoEstado,
          },
        });

        montoRestante -= descuento;
        deudaDescontadaTotal += descuento;

        await tx.movimientoFinanciero.create({
          data: {
            tenantId: pedido.tenantId,
            tipo: 'DESCUENTO_DEVOLUCION_CLIENTE',
            referenciaId: cobro.id,
            referenciaTabla: 'Cobro',
            clientId: pedido.clientId,
            monto: descuento,
            descripcion: `Descuento de $${descuento.toFixed(2)} por devolución de calzado (${totalParesADevolver} pares) en Pedido #${pedido.id.slice(0, 8)}`,
            userId,
          },
        });
      }

      // C. Saldo a favor si el monto devuelto supera la deuda pendiente del cliente
      const saldoAFavor = Math.max(0, Math.round(montoRestante * 100) / 100);
      if (saldoAFavor > 0) {
        const clienteActual = await tx.client.findUnique({ where: { id: pedido.clientId } });
        const saldoAnterior = clienteActual ? Number(clienteActual.saldoAFavor || 0) : 0;
        await tx.client.update({
          where: { id: pedido.clientId },
          data: { saldoAFavor: saldoAnterior + saldoAFavor },
        });

        await tx.movimientoFinanciero.create({
          data: {
            tenantId: pedido.tenantId,
            tipo: 'SALDO_FAVOR_CLIENTE',
            referenciaId: pedido.clientId,
            referenciaTabla: 'Client',
            clientId: pedido.clientId,
            monto: saldoAFavor,
            descripcion: `Saldo a favor de $${saldoAFavor.toFixed(2)} generado por devolución en Pedido #${pedido.id.slice(0, 8)}`,
            userId,
          },
        });
      }

      // D. Ajustar crédito utilizado del cliente
      if (deudaDescontadaTotal > 0) {
        const client = await tx.client.findUnique({ where: { id: pedido.clientId } });
        if (client) {
          const nuevoCreditoUtilizado = Math.max(0, Number(client.creditoUtilizado || 0) - deudaDescontadaTotal);
          await tx.client.update({
            where: { id: pedido.clientId },
            data: { creditoUtilizado: nuevoCreditoUtilizado },
          });
        }
      }

      // E. Crear registro formal ClienteDevolucion y sus líneas
      const estadoDevolucion = destinoStock === 'BAJA_POR_FALLA'
        ? 'PENDIENTE_DEVOLUCION_PROVEEDOR'
        : 'COMPLETADO';

      const motivoCompleto = `[${destinoStock === 'BAJA_POR_FALLA' ? 'MERMA/BAJA POR FALLA' : 'REINGRESO A BODEGA'}] ${dto.motivo.trim()}`;

      const devolucion = await tx.clienteDevolucion.create({
        data: {
          tenantId: pedido.tenantId,
          saleNoteId: saleNote?.id || null,
          orderId: pedido.id,
          clientId: pedido.clientId,
          motivo: motivoCompleto,
          totalDevuelto: montoTotalDevuelto,
          estado: estadoDevolucion,
          destinoStock,
          deudaDescontada: deudaDescontadaTotal,
          saldoAFavor,
          lines: {
            create: lineasAProcesar.map((item) => ({
              productId: item.line.productId,
              tallaId: item.line.tallaId,
              cantidad: item.cantidadADevolver,
              precioUnitario: Number(item.line.precioUnitario),
              subtotal: item.subtotal,
            })),
          },
        },
        include: { lines: true },
      });

      // F. Actualizar notas del pedido para bitácora trazable
      const notaDevolucion = `[Devolución ${totalParesADevolver} pares ($${montoTotalDevuelto.toFixed(2)}) - ${dto.motivo}]: ${new Date().toLocaleDateString('es-EC')}`;
      const notasActualizadas = pedido.notas ? `${pedido.notas} | ${notaDevolucion}` : notaDevolucion;

      await tx.order.update({
        where: { id: pedido.id },
        data: { notas: notasActualizadas },
      });

      return {
        devolucion,
        resumen: {
          totalParesDevueltos: totalParesADevolver,
          montoTotalDevuelto,
          deudaDescontada: deudaDescontadaTotal,
          saldoAFavor,
          destinoStock,
        },
      };
    });

    const pedidoActualizado = await this.queryService.obtenerPedido(pedido.id);

    return {
      success: true,
      message: `Devolución de ${resultadoTransaccion.resumen.totalParesDevueltos} pares registrada con éxito. Se descontó $${resultadoTransaccion.resumen.deudaDescontada.toFixed(2)} de la cartera.${resultadoTransaccion.resumen.saldoAFavor > 0 ? ` Saldo a favor del cliente: $${resultadoTransaccion.resumen.saldoAFavor.toFixed(2)}.` : ''}`,
      devolucion: resultadoTransaccion.devolucion,
      resumen: resultadoTransaccion.resumen,
      pedido: pedidoActualizado,
    };
  }

  /**
   * Endpoint para consultar las devoluciones registradas de un pedido.
   */
  @Get(':id/devoluciones')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  async obtenerDevolucionesPedido(@Param('id') id: string) {
    const devoluciones = await this.prisma.clienteDevolucion.findMany({
      where: { orderId: id },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });

    return devoluciones;
  }

  /**
   * Endpoint para corregir el precio de calzados en un pedido (incluso entregado).
   * Actualiza OrderLine, Order.montoTotal, SaleNote, Cobro y cuenta corriente de cartera.
   */
  @Patch(':id/corregir-precio')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async corregirPrecioPedido(
    @Param('id') id: string,
    @Body() dto: CorregirPrecioLineaDto,
  ) {
    const pedido = await this.prisma.order.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!pedido) {
      throw new NotFoundException(`El pedido con ID "${id}" no existe`);
    }

    // Normalizar items a procesar (permite procesar por modelo, serie, lista de lineIds/productIds o individual)
    const itemsAProcesar: Array<{ lineId?: string; lineIds?: string[]; productId?: string; productIds?: string[]; nuevoPrecio: number }> = [];

    if (dto.items && dto.items.length > 0) {
      for (const it of dto.items) {
        const p = Number(it.nuevoPrecioUnitario);
        if (!isNaN(p) && p > 0) {
          itemsAProcesar.push({
            lineId: it.lineId,
            lineIds: it.lineIds,
            productId: it.productId,
            productIds: it.productIds,
            nuevoPrecio: p,
          });
        }
      }
    } else if (dto.nuevoPrecioUnitario !== undefined && dto.nuevoPrecioUnitario !== null) {
      const p = Number(dto.nuevoPrecioUnitario);
      if (isNaN(p) || p <= 0) {
        throw new BadRequestException('El nuevo precio unitario debe ser un valor numérico mayor a 0');
      }
      itemsAProcesar.push({
        lineId: dto.lineId,
        lineIds: dto.lineIds,
        productId: dto.productId,
        productIds: dto.productIds,
        nuevoPrecio: p,
      });
    }

    if (itemsAProcesar.length === 0) {
      throw new BadRequestException('No se proporcionaron precios válidos a corregir');
    }

    // 1. Actualizar precio unitario en OrderLine y mapear precios por producto
    const nuevoPrecioPorProducto = new Map<string, number>();

    for (const item of itemsAProcesar) {
      let lineas = pedido.lines;
      if (item.lineIds && item.lineIds.length > 0) {
        lineas = pedido.lines.filter((l) => item.lineIds!.includes(l.id));
      } else if (item.lineId) {
        lineas = pedido.lines.filter((l) => l.id === item.lineId);
      } else if (item.productIds && item.productIds.length > 0) {
        lineas = pedido.lines.filter((l) => item.productIds!.includes(l.productId));
      } else if (item.productId) {
        lineas = pedido.lines.filter((l) => l.productId === item.productId);
      }

      for (const l of lineas) {
        await this.prisma.orderLine.update({
          where: { id: l.id },
          data: { precioUnitario: item.nuevoPrecio },
        });
        nuevoPrecioPorProducto.set(l.productId, item.nuevoPrecio);
      }
    }

    // 2. Recalcular monto total de la orden
    const todasLineas = await this.prisma.orderLine.findMany({
      where: { orderId: id },
    });
    const montoAnterior = Number(pedido.montoTotal);
    const nuevoMontoTotal = todasLineas.reduce(
      (acc, l) => acc + Number(l.precioUnitario) * l.cantidad,
      0,
    );
    const diferenciaMonto = nuevoMontoTotal - montoAnterior;

    await this.prisma.order.update({
      where: { id },
      data: { montoTotal: nuevoMontoTotal },
    });

    // 3. Si existe SaleNote (Nota de Venta) asociada, actualizar sus ítems y totales
    const saleNote = await this.prisma.saleNote.findFirst({
      where: { orderId: id },
      include: { lines: true },
    });

    if (saleNote) {
      for (const sl of saleNote.lines) {
        if (nuevoPrecioPorProducto.has(sl.productId)) {
          const np = nuevoPrecioPorProducto.get(sl.productId)!;
          await this.prisma.saleNoteLine.update({
            where: { id: sl.id },
            data: {
              precioUnitario: np,
              subtotal: np * sl.cantidad,
            },
          });
        }
      }

      const noteLinesActualizadas = await this.prisma.saleNoteLine.findMany({
        where: { saleNoteId: saleNote.id },
      });
      const nuevoTotalNote = noteLinesActualizadas.reduce((acc: number, l: any) => acc + Number(l.subtotal), 0);

      await this.prisma.saleNote.update({
        where: { id: saleNote.id },
        data: {
          subtotal: nuevoTotalNote,
          total: nuevoTotalNote,
        },
      });

      // 4. Si existe Cobro asociado, ajustar su monto y saldo
      const cobro = await this.prisma.cobro.findFirst({
        where: { saleNoteId: saleNote.id },
      });

      if (cobro) {
        const saldoAnterior = Number(cobro.saldoPendiente);
        const nuevoSaldo = Math.max(0, saldoAnterior + diferenciaMonto);

        await this.prisma.cobro.update({
          where: { id: cobro.id },
          data: {
            montoTotal: nuevoTotalNote,
            saldoPendiente: nuevoSaldo,
            estado: nuevoSaldo <= 0.01 ? 'SALDADO' : cobro.estado,
          },
        });

        // 5. Ajustar creditoUtilizado del cliente si fue a crédito
        if (pedido.tipoPago === 'CREDITO') {
          await this.prisma.client.update({
            where: { id: pedido.clientId },
            data: {
              creditoUtilizado: {
                increment: diferenciaMonto,
              },
            },
          });
        }
      }
    }

    const pedidoActualizado = await this.queryService.obtenerPedido(id);

    return {
      success: true,
      message: `Precios actualizados exitosamente. Total del pedido y saldos recalculados.`,
      pedido: pedidoActualizado,
      nuevoMontoTotal,
    };
  }

  // (Las rutas de despacho y ultimo-precio fueron movidas antes de @Get(':id') para evitar conflictos de enrutamiento)

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

  @Get(':id/verificar-stock-inter-sucursal/:sucursalOrigenId')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async verificarStockInterSucursal(
    @Param('id') id: string,
    @Param('sucursalOrigenId') sucursalOrigenId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        lines: true,
        tenant: true,
      },
    });
    if (!order) throw new NotFoundException(`Pedido con ID "${id}" no encontrado`);

    const sucursalOrigen = await this.prisma.tenant.findUnique({
      where: { id: sucursalOrigenId },
    });
    if (!sucursalOrigen) throw new NotFoundException('Sucursal de origen no encontrada');

    let tieneStockCompleto = true;
    let totalParesRequeridos = 0;
    let totalParesDisponibles = 0;
    const desgloseLineas: Array<{
      lineId: string;
      productId: string;
      modelName: string;
      color: string;
      tallaId: string;
      tallaNumero: number | string;
      cantidadRequerida: number;
      stockDisponible: number;
      cumple: boolean;
      faltante: number;
    }> = [];

    for (const line of order.lines) {
      totalParesRequeridos += line.cantidad;

      const prodOriginal = await this.prisma.product.findUnique({
        where: { id: line.productId },
        include: { model: true },
      });

      const tallaOriginal = await this.prisma.tallaConfig.findUnique({
        where: { id: line.tallaId },
      });

      const numeroTalla = tallaOriginal?.numero || '?';
      const modelName = prodOriginal?.model?.name || 'Calzado';
      const color = prodOriginal?.color || '';

      // Buscar producto equivalente en la sucursal de origen
      const prodOrigen = await this.prisma.product.findFirst({
        where: {
          model: { tenantId: sucursalOrigenId },
          OR: [
            { code: prodOriginal?.code },
            {
              AND: [
                { model: { name: { equals: prodOriginal?.model?.name, mode: 'insensitive' } } },
                { color: { equals: prodOriginal?.color, mode: 'insensitive' } },
              ],
            },
            { model: { name: { equals: prodOriginal?.model?.name, mode: 'insensitive' } } },
          ],
        },
        include: {
          stockByTalla: { include: { talla: true } },
          model: true,
        },
      });

      let stockDisponibleEnOrigen = 0;

      if (prodOrigen) {
        const stockTalla = prodOrigen.stockByTalla.find(
          (s: any) =>
            s.tallaId === line.tallaId ||
            (tallaOriginal && s.talla?.numero === tallaOriginal.numero),
        );

        if (stockTalla) {
          stockDisponibleEnOrigen = Math.max(
            0,
            (stockTalla.quantity || 0) - (stockTalla.reservedQuantity || 0),
          );
        }
      }

      const cumple = stockDisponibleEnOrigen >= line.cantidad;
      if (!cumple) {
        tieneStockCompleto = false;
      }

      const faltante = Math.max(0, line.cantidad - stockDisponibleEnOrigen);
      totalParesDisponibles += Math.min(stockDisponibleEnOrigen, line.cantidad);

      desgloseLineas.push({
        lineId: line.id,
        productId: line.productId,
        modelName,
        color,
        tallaId: line.tallaId,
        tallaNumero: numeroTalla,
        cantidadRequerida: line.cantidad,
        stockDisponible: stockDisponibleEnOrigen,
        cumple,
        faltante,
      });
    }

    const totalFaltante = Math.max(0, totalParesRequeridos - totalParesDisponibles);

    return {
      pedidoId: id,
      sucursalOrigenId,
      sucursalOrigenNombre: sucursalOrigen.name,
      tieneStockCompleto,
      totalParesRequeridos,
      totalParesDisponibles,
      totalFaltante,
      desgloseLineas,
    };
  }

  @Post(':id/solicitar-inter-sucursal')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async solicitarInterSucursal(
    @Param('id') id: string,
    @Body() dto: { sucursalOrigenId: string; modalidad: 'DEVOLUCION_MERCADERIA' | 'PAGO_INTERNO'; notas?: string },
    @Req() req: any,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { lines: true, tenant: true },
    });
    if (!order) throw new NotFoundException(`Pedido con ID "${id}" no encontrado`);

    const sucursalOrigen = await this.prisma.tenant.findUnique({
      where: { id: dto.sucursalOrigenId },
    });
    if (!sucursalOrigen) throw new NotFoundException('Sucursal de origen no encontrada');

    // 1. Verificación previa y estricta de stock disponible en la sucursal origen
    const verificacion = await this.verificarStockInterSucursal(id, dto.sucursalOrigenId);
    if (!verificacion.tieneStockCompleto) {
      throw new BadRequestException(
        `La sucursal "${sucursalOrigen.name}" no dispone del stock suficiente para este calzado (faltan ${verificacion.totalFaltante} pares). No es posible solicitar el préstamo.`,
      );
    }

    // 2. Transferir / descontar el stock requerido desde la sucursal prestamista
    for (const item of verificacion.desgloseLineas) {
      const prodOriginal = await this.prisma.product.findUnique({
        where: { id: item.productId },
        include: { model: true },
      });

      const prodOrigen = await this.prisma.product.findFirst({
        where: {
          model: { tenantId: dto.sucursalOrigenId },
          OR: [
            { code: prodOriginal?.code },
            {
              AND: [
                { model: { name: { equals: prodOriginal?.model?.name, mode: 'insensitive' } } },
                { color: { equals: prodOriginal?.color, mode: 'insensitive' } },
              ],
            },
            { model: { name: { equals: prodOriginal?.model?.name, mode: 'insensitive' } } },
          ],
        },
        include: { stockByTalla: { include: { talla: true } } },
      });

      if (prodOrigen) {
        const stockTallaOrigen = prodOrigen.stockByTalla.find(
          (s: any) =>
            s.tallaId === item.tallaId ||
            s.talla?.numero === item.tallaNumero,
        );

        if (stockTallaOrigen && stockTallaOrigen.quantity >= item.cantidadRequerida) {
          await this.prisma.stockByTalla.update({
            where: { id: stockTallaOrigen.id },
            data: { quantity: { decrement: item.cantidadRequerida } },
          });

          await this.prisma.stockMovement.create({
            data: {
              productId: prodOrigen.id,
              tallaId: stockTallaOrigen.tallaId,
              type: MovimientoTipo.AJUSTE,
              quantity: -item.cantidadRequerida,
              reason: `Préstamo inter-sucursal a ${order.tenant?.name || 'otra sucursal'} para Pedido #${order.id.slice(0, 8)}`,
              referenceId: order.id,
              userId: req.user.id || req.user.sub,
            },
          });
        }
      }
    }

    // Actualizar notas y estado del pedido para que pase a preparación
    const modalidadTexto = dto.modalidad === 'DEVOLUCION_MERCADERIA'
      ? 'Reposición física de pares al recibir mercadería'
      : 'Compensación económica interna';
    const detallePrestamo = `[Préstamo Inter-Sucursal]: Recibido de ${sucursalOrigen.name} (OrigenId: ${sucursalOrigen.id}). Modalidad: ${modalidadTexto}${dto.notas ? ` - Obs: ${dto.notas}` : ''}`;
    const notasActualizadas = order.notas ? `${order.notas} | ${detallePrestamo}` : detallePrestamo;

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        estado: EstadoPedido.EN_PREPARACION,
        notas: notasActualizadas,
      },
    });

    // Desactivar cola de espera si existía
    await this.prisma.orderQueue.updateMany({
      where: { orderId: id },
      data: { activa: false },
    });

    return {
      success: true,
      message: `Préstamo de mercadería registrado con éxito desde ${sucursalOrigen.name}. El pedido ha avanzado a Preparación.`,
      order: updated,
    };
  }
}

