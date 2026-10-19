import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Patch,
  Query,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';

import { RegistrarSupplierHandler } from '../application/commands/RegistrarSupplier.handler';
import { RegistrarSupplierCommand } from '../application/commands/RegistrarSupplier.command';
import { ActualizarSupplierHandler } from '../application/commands/ActualizarSupplier.handler';
import { ActualizarSupplierCommand } from '../application/commands/ActualizarSupplier.command';
import { CrearSupplierOrderHandler } from '../application/commands/CrearSupplierOrder.handler';
import { CrearSupplierOrderCommand } from '../application/commands/CrearSupplierOrder.command';
import { ActualizarSupplierOrderHandler } from '../application/commands/ActualizarSupplierOrder.handler';
import { ActualizarSupplierOrderCommand } from '../application/commands/ActualizarSupplierOrder.command';
import { RegistrarMerchandiseEntryHandler } from '../application/commands/RegistrarMerchandiseEntry.handler';
import { RegistrarMerchandiseEntryCommand } from '../application/commands/RegistrarMerchandiseEntry.command';
import { RegistrarSupplierPaymentHandler } from '../application/commands/RegistrarSupplierPayment.handler';

import { ProveedoresQueryService } from '../application/queries/ProveedoresQueryService';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import {
  RegistrarSupplierDto,
  ActualizarSupplierDto,
  CrearSupplierOrderDto,
  ActualizarSupplierOrderDto,
  RegistrarMerchandiseEntryDto,
  RegistrarSupplierPaymentDto,
} from './dto/proveedores.dto';
import { AutoDespachoOrdenesService } from './services/AutoDespachoOrdenes.service';
import {
  formatearNombres,
  formatearEmail,
  formatearDireccion,
  validarEmailEstricto,
} from '../../../shared/utils/text-formatters';
import { validarRuc, validarCedula } from '../../../shared/utils/ecuador-validators';

@Controller('proveedores')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProveedoresController {
  constructor(
    private readonly registrarSupplierHandler: RegistrarSupplierHandler,
    private readonly actualizarSupplierHandler: ActualizarSupplierHandler,
    private readonly crearOrderHandler: CrearSupplierOrderHandler,
    private readonly actualizarOrderHandler: ActualizarSupplierOrderHandler,
    private readonly registrarEntryHandler: RegistrarMerchandiseEntryHandler,
    private readonly registrarPaymentHandler: RegistrarSupplierPaymentHandler,
    private readonly queryService: ProveedoresQueryService,
    private readonly autoDespachoService: AutoDespachoOrdenesService,
    private readonly prisma: PrismaService,
  ) {}

  // ══════════════════════════════════════════
  // DESPACHO AUTOMÁTICO
  // ══════════════════════════════════════════

  @Post('auto-despacho/ejecutar-manual')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async ejecutarDespachoManual(@Req() req: any) {
    const res = await this.autoDespachoService.ejecutarDespachoPorTenant(req.user.tenantId, req.user.tenantName);
    return {
      ok: true,
      despachadas: res.despachadas,
      message: res.despachadas > 0
        ? `Se despacharon automáticamente ${res.despachadas} órdenes de compra a proveedores.`
        : 'No hay órdenes en estado borrador pendientes de despacho.',
    };
  }

  // ══════════════════════════════════════════
  // PROVEEDORES - POST / PUT / PATCH (antes de GET)
  // ══════════════════════════════════════════

  @Post()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async registrarProveedor(@Body() dto: RegistrarSupplierDto, @Req() req: any) {
    if (dto.ruc && !validarRuc(dto.ruc) && !validarCedula(dto.ruc)) {
      throw new BadRequestException('El RUC o Cédula ingresado no es válido (10 o 13 dígitos numéricos).');
    }
    if (dto.email) {
      const emailVal = validarEmailEstricto(dto.email);
      if (!emailVal.valido) {
        throw new BadRequestException(emailVal.mensaje);
      }
    }

    const razonSocialFormateada = (
      dto.razonSocial ||
      dto.nombreComercial ||
      `${dto.nombres || ''} ${dto.apellidos || ''}`
    ).trim();

    if (!razonSocialFormateada) {
      throw new BadRequestException('Debe ingresar la Razón Social o los Nombres y Apellidos del proveedor.');
    }

    const contactoFormateado = dto.contacto ? dto.contacto.trim() : (dto.nombres ? `${dto.nombres.trim()} ${dto.apellidos || ''}`.trim() : undefined);
    const direccionFormateada = dto.direccion ? formatearDireccion(dto.direccion) : undefined;
    const emailFormateado = dto.email ? formatearEmail(dto.email) : undefined;

    const id = await this.registrarSupplierHandler.execute(
      new RegistrarSupplierCommand(
        dto.ruc,
        razonSocialFormateada,
        req.user.tenantId,
        contactoFormateado,
        direccionFormateada,
        emailFormateado,
      ),
    );
    return { ok: true, id, message: 'Proveedor registrado correctamente.' };
  }

  @Put(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async actualizarProveedor(
    @Param('id') id: string,
    @Body() dto: ActualizarSupplierDto,
  ) {
    if (dto.email && dto.email.trim() !== '') {
      const emailVal = validarEmailEstricto(dto.email);
      if (!emailVal.valido) {
        throw new BadRequestException(emailVal.mensaje);
      }
    }

    await this.actualizarSupplierHandler.execute(
      new ActualizarSupplierCommand(
        id,
        dto.razonSocial,
        dto.contacto,
        dto.direccion,
        dto.email,
      ),
    );
    return { ok: true, message: 'Proveedor actualizado correctamente.' };
  }

  @Patch(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async patchProveedor(
    @Param('id') id: string,
    @Body() dto: ActualizarSupplierDto,
  ) {
    return this.actualizarProveedor(id, dto);
  }

  @Post('deuda-manual')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async registrarDeudaManual(
    @Body()
    body: {
      supplierId: string;
      monto: number;
      concepto: string;
      notas?: string;
      fechaVencimiento?: string;
      fechaEmision?: string;
    },
    @Req() req: any,
  ) {
    return this.queryService.registrarDeudaManual(body, req.user.tenantId, req.user.sub);
  }

  // ══════════════════════════════════════════
  // ÓRDENES DE COMPRA (SUPPLIER ORDERS) — RUTAS ESTÁTICAS PRIMERO
  // ══════════════════════════════════════════

  // ──────────────────────────────────────────
  // FASE 5.2 — Consolidación de Demanda para Órdenes de Compra
  // ──────────────────────────────────────────
  @Get('demanda-pendiente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async obtenerDemandaPendiente(@Query('supplierId') supplierId?: string) {
    // 1. Buscar todos los pedidos no cancelados que están esperando stock o pendientes
    const pedidosPendientes = await this.prisma.order.findMany({
      where: {
        estado: { in: ['EN_ESPERA_STOCK', 'PENDIENTE', 'EN_PREPARACION'] },
      },
      include: {
        lines: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Extraer todas las líneas que tengan déficit de stock
    const demandaMap = new Map<string, {
      productId: string;
      modelName: string;
      color: string;
      serieNombre: string;
      imageUrl: string | null;
      costPrice: number;
      supplierId: string | null;
      supplierName: string | null;
      tallasMap: Map<string, { tallaId: string; tallaNumero: number; paresFaltantes: number; stockActual: number }>;
      pedidosMap: Map<string, { orderId: string; numero: number | string; pares: number }>;
    }>();

    for (const ped of pedidosPendientes) {
      for (const line of ped.lines) {
        const cantPendiente = line.cantidad - (line.cantidadEntregada || 0);
        if (cantPendiente <= 0) continue;

        // Consultar stock de la talla
        const stockTalla = await this.prisma.stockByTalla.findUnique({
          where: {
            productId_tallaId: {
              productId: line.productId,
              tallaId: line.tallaId,
            },
          },
          include: { talla: true },
        });

        const stockDisp = stockTalla ? Math.max(0, stockTalla.quantity - stockTalla.reservedQuantity) : 0;
        const faltante = Math.max(0, cantPendiente - stockDisp);

        // Si hay faltante o el pedido está formalmente en espera de stock
        if (faltante > 0 || ped.estado === 'EN_ESPERA_STOCK') {
          const paresRequeridos = faltante > 0 ? faltante : cantPendiente;

          // Obtener información del producto
          if (!demandaMap.has(line.productId)) {
            const prod = await this.prisma.product.findUnique({
              where: { id: line.productId },
              include: {
                model: { include: { supplier: true } },
                supplier: true,
                serie: true,
              },
            });

            if (prod) {
              const assignedSupplier = prod.supplier || prod.model?.supplier || null;
              demandaMap.set(line.productId, {
                productId: prod.id,
                modelName: prod.model?.name || 'Modelo',
                color: prod.color || '',
                serieNombre: prod.serie?.nombre || 'ADULTO',
                imageUrl: prod.imageUrl || null,
                costPrice: Number(prod.costPrice || 0),
                supplierId: assignedSupplier?.id || null,
                supplierName: assignedSupplier ? (assignedSupplier.razonSocial || assignedSupplier.contacto || 'Proveedor Asignado') : 'Sin Proveedor Asignado',
                tallasMap: new Map(),
                pedidosMap: new Map(),
              });
            }
          }

          const entry = demandaMap.get(line.productId);
          if (entry) {
            const numTalla = stockTalla?.talla?.numero || 0;
            const tEntry = entry.tallasMap.get(line.tallaId) || {
              tallaId: line.tallaId,
              tallaNumero: numTalla,
              paresFaltantes: 0,
              stockActual: stockDisp,
            };
            tEntry.paresFaltantes += paresRequeridos;
            entry.tallasMap.set(line.tallaId, tEntry);

            const numPedido = ped.id.slice(0, 8).toUpperCase();
            const pEntry = entry.pedidosMap.get(ped.id) || {
              orderId: ped.id,
              numero: numPedido,
              pares: 0,
            };
            pEntry.pares += paresRequeridos;
            entry.pedidosMap.set(ped.id, pEntry);
          }
        }
      }
    }

    // 3. Formatear la respuesta agrupada
    let resultado = Array.from(demandaMap.values()).map((item) => {
      const tallas = Array.from(item.tallasMap.values()).sort((a, b) => a.tallaNumero - b.tallaNumero);
      const totalParesFaltantes = tallas.reduce((acc, t) => acc + t.paresFaltantes, 0);
      const pedidosAfectados = Array.from(item.pedidosMap.values());

      return {
        productId: item.productId,
        modelName: item.modelName,
        color: item.color,
        serieNombre: item.serieNombre,
        imageUrl: item.imageUrl,
        costPrice: item.costPrice,
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        totalParesFaltantes,
        tallas,
        pedidosAfectados,
        subtotalEstimado: totalParesFaltantes * item.costPrice,
      };
    });

    if (supplierId) {
      resultado = resultado.filter((r) => r.supplierId === supplierId);
    }

    return {
      totalModelos: resultado.length,
      totalParesFaltantes: resultado.reduce((sum, r) => sum + r.totalParesFaltantes, 0),
      items: resultado,
    };
  }

  @Post('ordenes-compra/consolidar-demanda')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async consolidarDemanda(@Body() dto: CrearSupplierOrderDto) {
    if (!dto.supplierId) {
      throw new BadRequestException('El proveedor es obligatorio para consolidar la orden.');
    }
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Debe incluir al menos un calzado para consolidar.');
    }

    const obsConsolidada = dto.observaciones
      ? `[Consolidación de Demanda de Clientes]: ${dto.observaciones}`
      : `[Consolidación de Demanda]: Orden generada automáticamente a partir de pedidos de clientes en espera de stock.`;

    const id = await this.crearOrderHandler.execute(
      new CrearSupplierOrderCommand(
        dto.supplierId,
        dto.lines,
        obsConsolidada,
        dto.estado || 'BORRADOR',
      ),
    );

    return {
      ok: true,
      id,
      message: 'Orden de compra consolidada generada con éxito.',
    };
  }

  @Post('ordenes-compra')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async crearOrdenCompra(@Body() dto: CrearSupplierOrderDto) {
    const id = await this.crearOrderHandler.execute(
      new CrearSupplierOrderCommand(
        dto.supplierId,
        dto.lines,
        dto.observaciones,
        dto.estado,
      ),
    );
    return { ok: true, id, message: 'Orden de compra a proveedor creada correctamente.' };
  }

  @Get('ordenes-compra')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async listarOrdenesCompra(
    @Req() req: any,
    @Query('supplierId') supplierId?: string,
    @Query('sucursalId') sucursalId?: string,
  ) {
    const isSuperAdmin = req.user?.rol === Rol.ROL_SUPER_ADMIN;
    const effectiveTenantId = sucursalId || (isSuperAdmin ? null : req.user?.tenantId);
    return this.queryService.listarOrdenesCompra(supplierId, effectiveTenantId);
  }

  @Get('ordenes-compra/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async obtenerOrdenCompra(@Param('id') id: string) {
    return this.queryService.obtenerOrdenCompra(id);
  }

  @Put('ordenes-compra/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async actualizarOrdenCompra(@Param('id') id: string, @Body() dto: ActualizarSupplierOrderDto) {
    await this.actualizarOrderHandler.execute(
      new ActualizarSupplierOrderCommand(
        id,
        dto.lines,
        dto.observaciones,
        dto.estado,
      ),
    );
    return { ok: true, message: 'Orden de compra actualizada correctamente.' };
  }

  @Patch('ordenes-compra/:id/confirmar')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async confirmarEnvioOrden(@Param('id') id: string) {
    await this.actualizarOrderHandler.execute(
      new ActualizarSupplierOrderCommand(id, undefined, undefined, 'PENDIENTE'),
    );
    return { ok: true, message: 'Orden enviada / confirmada con éxito al proveedor.' };
  }

  @Patch('ordenes-compra/:id/cancelar')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async cancelarOrden(@Param('id') id: string) {
    await this.actualizarOrderHandler.execute(
      new ActualizarSupplierOrderCommand(id, undefined, undefined, 'CANCELADA'),
    );
    return { ok: true, message: 'Orden de compra cancelada correctamente.' };
  }

  @Patch('ordenes-compra/:id/cancelar-y-desactivar-reorden')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async cancelarOrdenYDesactivarReorden(@Param('id') id: string) {
    // 1. Cancelar la orden de compra
    await this.actualizarOrderHandler.execute(
      new ActualizarSupplierOrderCommand(id, undefined, undefined, 'CANCELADA'),
    );

    // 2. Obtener productos de la orden para desactivar su reorden automática
    const orden = await this.prisma.supplierOrder.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (orden && orden.lines.length > 0) {
      const productIds = orden.lines.map((l: any) => l.productId);

      // Desactivar en Producto
      await this.prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { reordenAutomatica: false },
      });

      // Desactivar en Modelo Base
      const prods = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { modelId: true },
      });
      const modelIds = Array.from(new Set(prods.map((p: any) => p.modelId)));
      await this.prisma.productModel.updateMany({
        where: { id: { in: modelIds } },
        data: { reordenAutomatica: false },
      });

      // Limpiar líneas pendientes de estos productos en cualquier otra orden BORRADOR
      await this.prisma.supplierOrderLine.deleteMany({
        where: {
          productId: { in: productIds },
          order: { estado: 'BORRADOR' },
        },
      });
    }

    return {
      ok: true,
      message: 'Orden cancelada y reorden automática desactivada. El sistema no volverá a auto-generar pedidos para estos productos.',
    };
  }

  @Patch('ordenes-compra/:id/reasignar-proveedor')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async reasignarProveedorOrden(
    @Param('id') id: string,
    @Body('nuevoSupplierId') nuevoSupplierId: string,
  ) {
    const orden = await this.prisma.supplierOrder.findUnique({ where: { id } });
    if (!orden) throw new NotFoundException(`Orden con ID ${id} no encontrada`);

    if (orden.estado !== 'PENDIENTE' && orden.estado !== 'BORRADOR') {
      throw new BadRequestException('Solo se pueden reasignar órdenes en estado PENDIENTE o BORRADOR.');
    }

    const nuevoSupplier = await this.prisma.supplier.findUnique({ where: { id: nuevoSupplierId } });
    if (!nuevoSupplier) throw new NotFoundException(`Proveedor con ID ${nuevoSupplierId} no encontrado`);

    await this.prisma.supplierOrder.update({
      where: { id },
      data: { supplierId: nuevoSupplierId },
    });

    return {
      ok: true,
      message: `Orden reasignada exitosamente al proveedor "${nuevoSupplier.razonSocial}".`,
    };
  }

  @Patch('productos/:id/reorden-automatica')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async alternarReordenAutomatica(
    @Param('id') id: string,
    @Body('reordenAutomatica') reordenAutomatica: boolean,
  ) {
    const updated = await this.prisma.product.update({
      where: { id },
      data: { reordenAutomatica },
    });
    return { ok: true, data: updated };
  }

  // ══════════════════════════════════════════
  // INGRESO DE MERCANCÍA (MERCHANDISE ENTRIES) — RUTAS ESTÁTICAS
  // ══════════════════════════════════════════

  @Post('entradas')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async registrarEntradaMercancia(@Body() dto: RegistrarMerchandiseEntryDto) {
    const id = await this.registrarEntryHandler.execute(
      new RegistrarMerchandiseEntryCommand(
        dto.supplierId,
        dto.lines,
        dto.supplierOrderId,
        dto.observaciones,
        dto.estado,
      ),
    );
    return { ok: true, id, message: 'Entrada de mercancía registrada correctamente.' };
  }

  @Get('entradas')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async listarEntradasMercancia(@Req() req: any, @Query('supplierId') supplierId?: string) {
    return this.queryService.listarEntradasMercancia(supplierId, req.user.tenantId);
  }

  @Get('entradas/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async obtenerEntradaMercancia(@Param('id') id: string) {
    return this.queryService.obtenerEntradaMercancia(id);
  }

  // ══════════════════════════════════════════
  // PAGOS — RUTAS ESTÁTICAS
  // ══════════════════════════════════════════

  @Get('pagos/todos')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async listarTodosPagos(@Req() req: any) {
    return this.queryService.listarTodosPagos(req.user.tenantId);
  }

  // ══════════════════════════════════════════
  // BUSCAR PROVEEDORES GLOBAL — RUTA ESTÁTICA
  // ══════════════════════════════════════════

  @Get('buscar-global')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async buscarProveedoresGlobales(@Req() req: any, @Query('q') q?: string) {
    return this.queryService.buscarProveedoresGlobalesEmpresa(req.user.tenantId, q);
  }

  // ══════════════════════════════════════════
  // LISTAR PROVEEDORES (ruta base sin parámetro)
  // ══════════════════════════════════════════

  @Get()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async listarProveedores(@Req() req: any, @Query('q') q?: string) {
    return this.queryService.buscarProveedores(req.user.tenantId, q);
  }

  // ══════════════════════════════════════════
  // RUTAS CON PARÁMETRO :id — AL FINAL PARA EVITAR CONFLICTOS
  // (NestJS evalúa rutas en orden: si :id va antes de 'ordenes-compra',
  //  NestJS trata 'ordenes-compra' como un :id y nunca llega a la ruta correcta)
  // ══════════════════════════════════════════

  @Post(':id/pagos')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async registrarPagoProveedor(@Param('id') id: string, @Body() dto: RegistrarSupplierPaymentDto) {
    const pagoId = await this.registrarPaymentHandler.execute({
      supplierId: id,
      monto: dto.monto,
      metodo: dto.metodo,
      comprobante: dto.comprobante,
      banco: dto.banco,
      notas: dto.notas,
      supplierOrderId: dto.supplierOrderId,
    });
    return { ok: true, id: pagoId, message: 'Pago registrado correctamente en el estado de cuenta del proveedor.' };
  }

  @Get(':id/cuenta-corriente')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async obtenerCuentaCorriente(@Param('id') id: string) {
    return this.queryService.obtenerCuentaCorriente(id);
  }

  @Get(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_SUPER_ADMIN)
  async obtenerProveedor(@Param('id') id: string, @Req() req: any) {
    return this.queryService.obtenerProveedor(id, req.user.tenantId);
  }

}
