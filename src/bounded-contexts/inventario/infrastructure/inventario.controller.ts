import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
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
import { Rol, MovimientoTipo } from '@prisma/client';
import {
  CrearModeloDto,
  AgregarColorDto,
  CambiarPrecioDto,
  ReservarStockDto,
  MovimientoStockDto,
  BuscarProductosDto,
  ActualizarModeloDto,
  ActualizarProductoDto,
} from './dto/inventario.dto';
import { IProductoRepository } from '../domain/IProductoRepository';
import { Producto } from '../domain/Producto';
import { Money } from '../../../shared/domain/Money';
import { Serie } from '../domain/value-objects/Serie';
import { StockPorTalla } from '../domain/value-objects/StockPorTalla';
import { Talla } from '../domain/value-objects/Talla';
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
import { CloudinaryService } from '../../../shared/infrastructure/cloudinary/cloudinary.service';

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
    private readonly cloudinaryService: CloudinaryService,
    @Inject('IProductoRepository')
    private readonly productoRepository: IProductoRepository,
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
      dto.seriesPrices ?? null,
      dto.customTallas ?? null,
      dto.supplierId ?? null,
    );
    const result = await this.crearProductoHandler.execute(command);
    return { ...result, message: 'Modelo y variantes creados exitosamente' };
  }

  @Post('modelos/:id/colores')
  @Roles(Rol.ROL_ADMIN)
  async agregarColorAModelo(
    @Param('id') modelId: string,
    @Body() dto: AgregarColorDto,
  ) {
    const model = await this.prisma.productModel.findUnique({
      where: { id: modelId },
    });
    if (!model) throw new NotFoundException(`Modelo con ID ${modelId} no encontrado`);

    const seriesConfigs = await this.prisma.seriesConfig.findMany({
      where: { id: { in: dto.serieIds } },
      include: { tallas: { orderBy: { numero: 'asc' } } },
    });

    if (seriesConfigs.length !== dto.serieIds.length) {
      throw new NotFoundException('Algunas de las series seleccionadas no existen');
    }

    const createdProductIds: string[] = [];
    const stockInicial = dto.stockInicial ?? 1;

    for (const serieConfig of seriesConfigs) {
      const serieVO = Serie.create(serieConfig.nombre);

      const colorClean = dto.color.trim();
      const colorSuffix = colorClean.substring(0, 3).toUpperCase();
      const serieSuffix = serieConfig.nombre.substring(0, 3).toUpperCase();
      let code = `${model.baseCode}-${colorSuffix}-${serieSuffix}`;

      const existeCodigo = await this.productoRepository.findByCodigo(code);
      if (existeCodigo) {
        code = `${code}-${Math.floor(Math.random() * 899 + 100)}`;
      }

      const stockPorTallaList: StockPorTalla[] = [];
      const customTallaIds = dto.customTallas?.[serieConfig.id];

      if (customTallaIds && customTallaIds.length > 0) {
        const tallaCountMap = new Map<string, number>();
        for (const tid of customTallaIds) {
          tallaCountMap.set(tid, (tallaCountMap.get(tid) || 0) + 1);
        }
        for (const [tallaId, count] of tallaCountMap.entries()) {
          const tallaConfig = serieConfig.tallas.find(t => t.id === tallaId);
          if (!tallaConfig) continue;
          Talla.create(tallaConfig.numero, serieVO);
          stockPorTallaList.push(
            StockPorTalla.create(tallaId, stockInicial * count, 0, 0)
          );
        }
      } else {
        for (const talla of serieConfig.tallas) {
          Talla.create(talla.numero, serieVO);
          stockPorTallaList.push(
            StockPorTalla.create(talla.id, stockInicial, 0, 0)
          );
        }
      }

      const seriePrices = dto.seriesPrices?.[serieConfig.id];
      const finalCostPrice = seriePrices?.costPrice ?? 10;
      const finalSalePrice = seriePrices?.salePrice ?? 13;

      const productoId = crypto.randomUUID();
      const producto = Producto.crear(
        productoId,
        modelId,
        code,
        colorClean,
        dto.imageUrl ?? null,
        Money.create(finalCostPrice),
        Money.create(finalSalePrice),
        serieVO,
        stockPorTallaList,
      );

      await this.productoRepository.save(producto);
      createdProductIds.push(productoId);
    }

    return {
      message: `Color "${dto.color}" añadido exitosamente al modelo "${model.name}"`,
      productIds: createdProductIds,
    };
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

  @Post('productos/:id/entrada-lote')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_BODEGUERO)
  async aumentarStockLote(
    @Param('id') id: string,
    @Body() dto: { items: { tallaId: string; cantidad: number }[]; motivo: string; referenceId?: string },
    @Req() req: any,
  ) {
    if (!dto.items || !Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('El lote de ingreso debe contener al menos una talla con cantidad.');
    }
    const producto = await this.productoRepository.findById(id);
    if (!producto) {
      throw new NotFoundException(`El producto con ID "${id}" no existe`);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        if (!item.tallaId || !item.cantidad || item.cantidad <= 0) continue;
        producto.aumentarStock(item.tallaId, item.cantidad);
        await tx.stockMovement.create({
          data: {
            productId: id,
            tallaId: item.tallaId,
            type: MovimientoTipo.ENTRADA_MERCANCIA,
            quantity: item.cantidad,
            reason: dto.motivo,
            referenceId: dto.referenceId ?? null,
            userId: req.user.sub,
          },
        });
      }
      await this.productoRepository.update(producto);
    });

    return { message: 'Entrada multiformato por serie/lote registrada exitosamente' };
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

  @Put('modelos/:id')
  @Roles(Rol.ROL_ADMIN)
  async actualizarModelo(
    @Param('id') id: string,
    @Body() dto: ActualizarModeloDto,
  ) {
    const model = await this.prisma.productModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException(`Modelo con ID ${id} no encontrado`);

    const updated = await this.prisma.productModel.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.brand && { brand: dto.brand }),
        ...(dto.material !== undefined && { material: dto.material }),
        ...(dto.baseCode && { baseCode: dto.baseCode }),
      },
    });

    return { message: 'Modelo actualizado exitosamente', model: updated };
  }

  @Put('productos/:id')
  @Roles(Rol.ROL_ADMIN)
  async actualizarProducto(
    @Param('id') id: string,
    @Body() dto: ActualizarProductoDto,
    @Req() req: any,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { stockByTalla: true },
    });
    if (!product) throw new NotFoundException(`Producto con ID ${id} no encontrado`);

    // Si cambió de imagen y la anterior era de Cloudinary y es distinta, limpiamos la anterior
    if (dto.imageUrl && product.imageUrl && product.imageUrl !== dto.imageUrl && product.imageUrl.includes('cloudinary.com')) {
      await this.cloudinaryService.deleteImage(product.imageUrl).catch(() => null);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(dto.color && { color: dto.color }),
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
          ...(dto.costPrice && { costPrice: dto.costPrice }),
          ...(dto.salePrice && { salePrice: dto.salePrice }),
        },
      });

      // Si se enviaron tallas para actualizar stock
      if (Array.isArray(dto.tallas) && dto.tallas.length > 0) {
        for (const t of dto.tallas) {
          if (!t.tallaId || t.cantidad === undefined || t.cantidad < 0) continue;
          await tx.stockByTalla.upsert({
            where: {
              productId_tallaId: {
                productId: id,
                tallaId: t.tallaId,
              },
            },
            update: {
              quantity: t.cantidad,
            },
            create: {
              productId: id,
              tallaId: t.tallaId,
              quantity: t.cantidad,
              reservedQuantity: 0,
            },
          });
        }
      }
    });

    return { message: 'Variante de calzado actualizada exitosamente' };
  }

  @Delete('modelos/:id')
  @Roles(Rol.ROL_ADMIN)
  async eliminarModelo(@Param('id') id: string) {
    const model = await this.prisma.productModel.findUnique({
      where: { id },
      include: { products: true },
    });
    if (!model) throw new NotFoundException(`Modelo con ID ${id} no encontrado`);

    // Eliminar fotos asociadas de Cloudinary
    if (model.products && model.products.length > 0) {
      for (const p of model.products) {
        if (p.imageUrl && p.imageUrl.includes('cloudinary.com')) {
          await this.cloudinaryService.deleteImage(p.imageUrl);
        }
      }
    }

    await this.prisma.productModel.delete({ where: { id } });

    return { message: `Modelo ${model.name} y sus fotos eliminados permanentemente exitosamente` };
  }

  @Delete('productos/:id')
  @Roles(Rol.ROL_ADMIN)
  async eliminarProducto(@Param('id') id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Producto con ID ${id} no encontrado`);

    if (product.imageUrl && product.imageUrl.includes('cloudinary.com')) {
      await this.cloudinaryService.deleteImage(product.imageUrl);
    }

    await this.prisma.product.delete({ where: { id } });

    return { message: `Variante de calzado y su foto eliminadas permanentemente` };
  }
}
