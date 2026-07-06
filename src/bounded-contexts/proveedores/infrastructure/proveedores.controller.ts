import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';

import { RegistrarSupplierHandler } from '../application/commands/RegistrarSupplier.handler';
import { RegistrarSupplierCommand } from '../application/commands/RegistrarSupplier.command';
import { CrearSupplierOrderHandler } from '../application/commands/CrearSupplierOrder.handler';
import { CrearSupplierOrderCommand } from '../application/commands/CrearSupplierOrder.command';
import { RegistrarMerchandiseEntryHandler } from '../application/commands/RegistrarMerchandiseEntry.handler';
import { RegistrarMerchandiseEntryCommand } from '../application/commands/RegistrarMerchandiseEntry.command';

import { ProveedoresQueryService } from '../application/queries/ProveedoresQueryService';
import { RegistrarSupplierDto, CrearSupplierOrderDto, RegistrarMerchandiseEntryDto } from './dto/proveedores.dto';

@Controller('proveedores')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProveedoresController {
  constructor(
    private readonly registrarSupplierHandler: RegistrarSupplierHandler,
    private readonly crearOrderHandler: CrearSupplierOrderHandler,
    private readonly registrarEntryHandler: RegistrarMerchandiseEntryHandler,
    private readonly queryService: ProveedoresQueryService,
  ) {}

  // ══════════════════════════════════════════
  // PROVEEDORES
  // ══════════════════════════════════════════

  @Post()
  @Roles(Rol.ROL_ADMIN)
  async registrarProveedor(@Body() dto: RegistrarSupplierDto) {
    const id = await this.registrarSupplierHandler.execute(
      new RegistrarSupplierCommand(
        dto.ruc,
        dto.razonSocial,
        dto.contacto,
        dto.direccion,
        dto.email,
      ),
    );
    return { ok: true, id, message: 'Proveedor registrado correctamente.' };
  }

  @Get()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async listarProveedores(@Query('q') q?: string) {
    return this.queryService.buscarProveedores(q);
  }

  @Get(':id')
  @Roles(Rol.ROL_ADMIN)
  async obtenerProveedor(@Param('id') id: string) {
    return this.queryService.obtenerProveedor(id);
  }

  // ══════════════════════════════════════════
  // ÓRDENES DE COMPRA (SUPPLIER ORDERS)
  // ══════════════════════════════════════════

  @Post('ordenes-compra')
  @Roles(Rol.ROL_ADMIN)
  async crearOrdenCompra(@Body() dto: CrearSupplierOrderDto) {
    const id = await this.crearOrderHandler.execute(
      new CrearSupplierOrderCommand(dto.supplierId, dto.lines),
    );
    return { ok: true, id, message: 'Orden de compra a proveedor creada correctamente.' };
  }

  @Get('ordenes-compra')
  @Roles(Rol.ROL_ADMIN)
  async listarOrdenesCompra(@Query('supplierId') supplierId?: string) {
    return this.queryService.listarOrdenesCompra(supplierId);
  }

  @Get('ordenes-compra/:id')
  @Roles(Rol.ROL_ADMIN)
  async obtenerOrdenCompra(@Param('id') id: string) {
    return this.queryService.obtenerOrdenCompra(id);
  }

  // ══════════════════════════════════════════
  // INGRESO DE MERCANCÍA (MERCHANDISE ENTRIES)
  // ══════════════════════════════════════════

  @Post('entradas')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async registrarEntradaMercancia(@Body() dto: RegistrarMerchandiseEntryDto) {
    const id = await this.registrarEntryHandler.execute(
      new RegistrarMerchandiseEntryCommand(dto.supplierId, dto.lines, dto.supplierOrderId),
    );
    return { ok: true, id, message: 'Entrada de mercancía registrada correctamente.' };
  }

  @Get('entradas')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async listarEntradasMercancia(@Query('supplierId') supplierId?: string) {
    return this.queryService.listarEntradasMercancia(supplierId);
  }

  @Get('entradas/:id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async obtenerEntradaMercancia(@Param('id') id: string) {
    return this.queryService.obtenerEntradaMercancia(id);
  }
}
