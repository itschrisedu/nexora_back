import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class StockReservado extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly cantidad: number,
    public readonly reservaId: string,
    public readonly expiresAt: Date,
  ) {
    super('inventario.stock_reservado');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      tallaId: this.tallaId,
      cantidad: this.cantidad,
      reservaId: this.reservaId,
      expiresAt: this.expiresAt.toISOString(),
    };
  }
}
