import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { IProductoRepository } from '../../domain/IProductoRepository';
import { CrearProductoCommand } from './CrearProducto.command';
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

  async execute(command: CrearProductoCommand): Promise<string> {
    // 1. Verificar si el código ya existe
    const existeCodigo = await this.productoRepository.findByCodigo(command.codigo);
    if (existeCodigo) {
      throw new ConflictException(`El producto con código "${command.codigo}" ya existe`);
    }

    // 2. Resolver la serie
    const serieConfig = await this.prisma.seriesConfig.findUnique({
      where: { id: command.serieId },
    });
    if (!serieConfig) {
      throw new NotFoundException(`La serie con ID "${command.serieId}" no existe`);
    }

    const serieVO = Serie.create(serieConfig.nombre);

    // 3. Resolver y validar las tallas
    const stockPorTallaList: StockPorTalla[] = [];

    for (const tallaInput of command.tallas) {
      const tallaConfig = await this.prisma.tallaConfig.findUnique({
        where: { id: tallaInput.tallaId },
      });

      if (!tallaConfig) {
        throw new NotFoundException(`La talla con ID "${tallaInput.tallaId}" no existe`);
      }

      // Validar invariantes de talla/serie
      Talla.create(tallaConfig.numero, serieVO);

      stockPorTallaList.push(
        StockPorTalla.create(
          tallaInput.tallaId,
          tallaInput.stockInicial,
          0,
          tallaInput.stockMinimo,
        ),
      );
    }

    // 4. Crear el aggregate Producto
    const productoId = crypto.randomUUID();
    const producto = Producto.crear(
      productoId,
      command.codigo,
      command.nombre,
      command.marca,
      command.modelo,
      command.material,
      command.fotoUrl,
      Money.create(command.precioCosto),
      Money.create(command.precioVenta),
      serieVO,
      stockPorTallaList,
    );

    // 5. Guardar en base de datos
    await this.productoRepository.save(producto);

    return producto.id;
  }
}
