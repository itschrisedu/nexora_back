import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class StockLiberado extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly cantidad: number,
  ) {
    super('inventario.stock_liberado');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      tallaId: this.tallaId,
      cantidad: this.cantidad,
    };
  }
}
