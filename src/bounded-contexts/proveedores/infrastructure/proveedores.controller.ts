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
import { validarRuc } from '../../../shared/utils/ecuador-validators';

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

  @Post('auto-despacho/ejecutar-manual')
  @Roles(Rol.ROL_ADMIN)
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
  // PROVEEDORES
  // ══════════════════════════════════════════

  @Post()
  @Roles(Rol.ROL_ADMIN)
  async registrarProveedor(@Body() dto: RegistrarSupplierDto, @Req() req: any) {
    if (dto.ruc && !validarRuc(dto.ruc)) {
      throw new BadRequestException('El RUC ecuatoriano ingresado no es válido (13 dígitos numéricos).');
    }
    if (dto.email) {
      const emailVal = validarEmailEstricto(dto.email);
      if (!emailVal.valido) {
        throw new BadRequestException(emailVal.mensaje);
      }
    }

    const razonSocialFormateada = dto.razonSocial ? dto.razonSocial.trim() : '';
    const contactoFormateado = dto.contacto ? formatearNombres(dto.contacto, 3) : undefined;
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
  @Roles(Rol.ROL_ADMIN)
  async actualizarProveedor(
    @Param('id') id: string,
    @Body() dto: ActualizarSupplierDto,
  ) {
    if (dto.email) {
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
  @Roles(Rol.ROL_ADMIN)
  async patchProveedor(
    @Param('id') id: string,
    @Body() dto: ActualizarSupplierDto,
  ) {
    return this.actualizarProveedor(id, dto);
  }

  @Get()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async listarProveedores(@Req() req: any, @Query('q') q?: string) {
    return this.queryService.buscarProveedores(req.user.tenantId, q);
  }

  @Get(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async obtenerProveedor(@Param('id') id: string) {
    return this.queryService.obtenerProveedor(id);
  }

  @Get('pagos/todos')
  @Roles(Rol.ROL_ADMIN)
  async listarTodosPagos(@Req() req: any) {
    return this.queryService.listarTodosPagos(req.user.tenantId);
  }

  // ══════════════════════════════════════════
  // ÓRDENES DE COMPRA (SUPPLIER ORDERS)
  // ══════════════════════════════════════════

  @Post('ordenes-compra')
  @Roles(Rol.ROL_ADMIN)
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
  @Roles(Rol.ROL_ADMIN)
  async listarOrdenesCompra(@Req() req: any, @Query('supplierId') supplierId?: string) {
    return this.queryService.listarOrdenesCompra(supplierId, req.user.tenantId);
  }

  @Get('ordenes-compra/:id')
  @Roles(Rol.ROL_ADMIN)
  async obtenerOrdenCompra(@Param('id') id: string) {
    return this.queryService.obtenerOrdenCompra(id);
  }

  @Put('ordenes-compra/:id')
  @Roles(Rol.ROL_ADMIN)
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
  @Roles(Rol.ROL_ADMIN)
  async confirmarEnvioOrden(@Param('id') id: string) {
    await this.actualizarOrderHandler.execute(
      new ActualizarSupplierOrderCommand(id, undefined, undefined, 'PENDIENTE'),
    );
    return { ok: true, message: 'Orden enviada / confirmada con éxito al proveedor.' };
  }

  @Patch('ordenes-compra/:id/cancelar')
  @Roles(Rol.ROL_ADMIN)
  async cancelarOrden(@Param('id') id: string) {
    await this.actualizarOrderHandler.execute(
      new ActualizarSupplierOrderCommand(id, undefined, undefined, 'CANCELADA'),
    );
    return { ok: true, message: 'Orden de compra cancelada correctamente.' };
  }

  @Patch('ordenes-compra/:id/cancelar-y-desactivar-reorden')
  @Roles(Rol.ROL_ADMIN)
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
  @Roles(Rol.ROL_ADMIN)
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
  @Roles(Rol.ROL_ADMIN)
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
  // INGRESO DE MERCANCÍA (MERCHANDISE ENTRIES)
  // ══════════════════════════════════════════

  @Post('entradas')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
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
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async listarEntradasMercancia(@Req() req: any, @Query('supplierId') supplierId?: string) {
    return this.queryService.listarEntradasMercancia(supplierId, req.user.tenantId);
  }

  @Get('entradas/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async obtenerEntradaMercancia(@Param('id') id: string) {
    return this.queryService.obtenerEntradaMercancia(id);
  }

  // ══════════════════════════════════════════
  // PAGOS Y CUENTA CORRIENTE POR PROVEEDOR
  // ══════════════════════════════════════════

  @Post(':id/pagos')
  @Roles(Rol.ROL_ADMIN)
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
  @Roles(Rol.ROL_ADMIN)
  async obtenerCuentaCorriente(@Param('id') id: string) {
    return this.queryService.obtenerCuentaCorriente(id);
  }

}

