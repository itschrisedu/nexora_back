import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { IProductoRepository } from '../../domain/IProductoRepository';
import { CrearModeloCommand } from './CrearProducto.command';
import { Producto } from '../../domain/Producto';
import { Money } from '../../../../shared/domain/Money';
import { Serie } from '../../domain/value-objects/Serie';
import { StockPorTalla } from '../../domain/value-objects/StockPorTalla';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { Talla } from '../../domain/value-objects/Talla';

@Injectable()
export class CrearProductoHandler {
  constructor(
    @Inject('IProductoRepository')
    private readonly productoRepository: IProductoRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: CrearModeloCommand): Promise<{ modelId: string; productIds: string[] }> {
    // 1. Verificar si el baseCode ya existe
    const existeModelo = await this.prisma.productModel.findUnique({
      where: { baseCode: command.baseCode },
    });
    if (existeModelo) {
      throw new ConflictException(`El modelo con código base "${command.baseCode}" ya existe`);
    }

    // 2. Crear el modelo padre
    const modelId = crypto.randomUUID();
    await this.prisma.productModel.create({
      data: {
        id: modelId,
        baseCode: command.baseCode,
        name: command.name,
        brand: command.brand,
        material: command.material,
        supplierId: command.supplierId || undefined,
        tenantId: command.tenantId!,
      },
    });

    // 3. Resolver las series seleccionadas
    const seriesConfigs = await this.prisma.seriesConfig.findMany({
      where: { id: { in: command.serieIds } },
      include: { tallas: { orderBy: { numero: 'asc' } } },
    });

    if (seriesConfigs.length !== command.serieIds.length) {
      throw new NotFoundException('Algunas de las series seleccionadas no existen');
    }

    // 4. Generar productos para cada combinación de color x serie
    const productIds: string[] = [];

    for (const colorEntry of command.colors) {
      for (const serieConfig of seriesConfigs) {
        const serieVO = Serie.create(serieConfig.nombre);

        // Generar código único: BASECODE-COLOR(3)-SERIE(3)
        const colorSuffix = colorEntry.color.substring(0, 3).toUpperCase();
        const serieSuffix = serieConfig.nombre.substring(0, 3).toUpperCase();
        const code = `${command.baseCode}-${colorSuffix}-${serieSuffix}`;

        // Verificar que no exista un producto con ese código
        const existeCodigo = await this.productoRepository.findByCodigo(code);
        if (existeCodigo) {
          throw new ConflictException(`El producto con código "${code}" ya existe`);
        }

        // Crear stock por talla — con soporte para tallas personalizadas
        const stockPorTallaList: StockPorTalla[] = [];

        // Verificar si hay tallas personalizadas para esta serie
        const customTallaIds = command.customTallas?.[serieConfig.id];

        if (customTallaIds && customTallaIds.length > 0) {
          // Modo personalizado: el usuario eligió tallas específicas
          // Contar repeticiones de cada tallaId para calcular stock extra
          const tallaCountMap = new Map<string, number>();
          for (const tid of customTallaIds) {
            tallaCountMap.set(tid, (tallaCountMap.get(tid) || 0) + 1);
          }

          for (const [tallaId, count] of tallaCountMap.entries()) {
            // Verificar que la talla pertenece a esta serie
            const tallaConfig = serieConfig.tallas.find(t => t.id === tallaId);
            if (!tallaConfig) continue;

            Talla.create(tallaConfig.numero, serieVO);
            stockPorTallaList.push(
              StockPorTalla.create(
                tallaId,
                command.stockInicial * count, // Stock multiplicado por repeticiones
                0,
                command.stockMinimo,
              ),
            );
          }
        } else {
          // Modo estándar: usar TODAS las tallas de la serie
          for (const talla of serieConfig.tallas) {
            Talla.create(talla.numero, serieVO);
            stockPorTallaList.push(
              StockPorTalla.create(
                talla.id,
                command.stockInicial,
                0,
                command.stockMinimo,
              ),
            );
          }
        }

        // Determinar precios: usar precios por serie si están disponibles
        const seriePrices = command.seriesPrices?.[serieConfig.id];
        const finalCostPrice = seriePrices?.costPrice ?? command.costPrice;
        const finalSalePrice = seriePrices?.salePrice ?? command.salePrice;

        const productoId = crypto.randomUUID();
        const producto = Producto.crear(
          productoId,
          modelId,
          code,
          colorEntry.color,
          colorEntry.imageUrl,
          Money.create(finalCostPrice),
          Money.create(finalSalePrice),
          serieVO,
          stockPorTallaList,
        );

        await this.productoRepository.save(producto);
        productIds.push(productoId);
      }
    }

    return { modelId, productIds };
  }
}
