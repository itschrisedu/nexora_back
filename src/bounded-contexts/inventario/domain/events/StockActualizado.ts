import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class StockActualizado extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly cantidadAnterior: number,
    public readonly cantidadNueva: number,
  ) {
    super('inventario.stock_actualizado');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      tallaId: this.tallaId,
      cantidadAnterior: this.cantidadAnterior,
      cantidadNueva: this.cantidadNueva,
    };
  }
}
