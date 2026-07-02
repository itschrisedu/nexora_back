import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class ReservaExpirada extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly cantidad: number,
    public readonly reservaId: string,
  ) {
    super('inventario.reserva_expirada');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      tallaId: this.tallaId,
      cantidad: this.cantidad,
      reservaId: this.reservaId,
    };
  }
}
