import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class PrecioCambiado extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly precioCostoAnterior: number,
    public readonly precioVentaAnterior: number,
    public readonly precioCostoNuevo: number,
    public readonly precioVentaNuevo: number,
    public readonly userId: string,
  ) {
    super('inventario.precio_cambiado');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      precioCostoAnterior: this.precioCostoAnterior,
      precioVentaAnterior: this.precioVentaAnterior,
      precioCostoNuevo: this.precioCostoNuevo,
      precioVentaNuevo: this.precioVentaNuevo,
      userId: this.userId,
    };
  }
}
