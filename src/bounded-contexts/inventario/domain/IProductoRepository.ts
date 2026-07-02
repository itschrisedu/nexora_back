import { Producto } from './Producto';

/**
 * IProductoRepository — Contrato del repositorio de productos.
 * Se usa abstract class en lugar de interface para ser compatible
 * con la inyección de dependencias de NestJS + isolatedModules.
 */
export abstract class IProductoRepository {
  abstract findById(id: string): Promise<Producto | null>;
  abstract findByCodigo(codigo: string): Promise<Producto | null>;
  abstract findBySerie(serie: string): Promise<Producto[]>;
  abstract findConStockBajo(): Promise<Producto[]>;
  abstract save(producto: Producto): Promise<void>;
  abstract update(producto: Producto): Promise<void>;
}
