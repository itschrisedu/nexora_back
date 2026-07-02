import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class StockInsuficiente extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly stockDisponible: number,
    public readonly cantidadSolicitada: number,
  ) {
    super('inventario.stock_insuficiente');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      tallaId: this.tallaId,
      stockDisponible: this.stockDisponible,
      cantidadSolicitada: this.cantidadSolicitada,
    };
  }
}
