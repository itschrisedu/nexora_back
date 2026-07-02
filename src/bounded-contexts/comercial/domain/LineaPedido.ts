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

export class LineaPedido extends Entity<LineaPedidoProps> {
  private constructor(id: string, props: LineaPedidoProps) {
    super(id, props);
  }

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
