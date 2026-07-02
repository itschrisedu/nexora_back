import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class StockDadoDeBaja extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly cantidad: number,
    public readonly motivo: string,
  ) {
    super('inventario.stock_dado_de_baja');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      tallaId: this.tallaId,
      cantidad: this.cantidad,
      motivo: this.motivo,
    };
  }
}
