import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class StockDisponible extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly cantidadDisponible: number,
  ) {
    super('inventario.stock_disponible');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      tallaId: this.tallaId,
      cantidadDisponible: this.cantidadDisponible,
    };
  }
}
