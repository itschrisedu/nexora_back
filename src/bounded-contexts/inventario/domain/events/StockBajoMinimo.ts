import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class StockBajoMinimo extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly stockActual: number,
    public readonly stockMinimo: number,
  ) {
    super('inventario.stock_bajo_minimo');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      tallaId: this.tallaId,
      stockActual: this.stockActual,
      stockMinimo: this.stockMinimo,
    };
  }
}
