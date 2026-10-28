import { Entity } from '../../../shared/domain/Entity';
import { Money } from '../../../shared/domain/Money';
import { TipoVenta } from './value-objects/TipoVenta';

export interface LineaPedidoProps {
  productId: string;
  serieId: string;
  tallaId: string;
  cantidad: number;
  precioUnitario: Money;
  tipoVenta: TipoVenta;
}

/**
 * Entidad de dominio que representa un ítem o renglón dentro de un pedido comercial.
 * Almacena el calzado específico, serie, talla, cantidad de pares y precio unitario pactado.
 */
export class LineaPedido extends Entity<LineaPedidoProps> {
  private constructor(id: string, props: LineaPedidoProps) {
    super(id, props);
  }

  /**
   * Método de fábrica para instanciar una línea de pedido comercial.
   * Valida que la cantidad de pares solicitada sea estrictamente mayor a cero.
   *
   * @param id Identificador único de la línea (UUID).
   * @param productId Identificador del calzado específico.
   * @param serieId Identificador de la serie o curva de tallas.
   * @param tallaId Identificador de la talla solicitada.
   * @param cantidad Cantidad de pares pedidos.
   * @param precioUnitario Precio de venta por par.
   * @param tipoVenta Modalidad de comercialización (PAR o CURVA).
   * @returns Instancia de LineaPedido validada.
   */
  static crear(
    id: string,
    productId: string,
    serieId: string,
    tallaId: string,
    cantidad: number,
    precioUnitario: Money,
    tipoVenta: TipoVenta,
  ): LineaPedido {
    if (cantidad <= 0) {
      throw new Error('La cantidad de la línea de pedido debe ser mayor que cero');
    }
    return new LineaPedido(id, {
      productId,
      serieId,
      tallaId,
      cantidad,
      precioUnitario,
      tipoVenta,
    });
  }

  get productId(): string {
    return this.props.productId;
  }

  get serieId(): string {
    return this.props.serieId;
  }

  get tallaId(): string {
    return this.props.tallaId;
  }

  get cantidad(): number {
    return this.props.cantidad;
  }

  get precioUnitario(): Money {
    return this.props.precioUnitario;
  }

  get tipoVenta(): TipoVenta {
    return this.props.tipoVenta;
  }

  get subtotal(): Money {
    return this.precioUnitario.multiply(this.cantidad);
  }

  static reconstruir(id: string, props: LineaPedidoProps): LineaPedido {
    return new LineaPedido(id, props);
  }
}
