import { DomainEvent } from '../../../../shared/domain/DomainEvent';

export class ProductoCreado extends DomainEvent {
  constructor(
    public readonly productoId: string,
    public readonly codigo: string,
    public readonly serie: string,
  ) {
    super('inventario.producto_creado');
  }

  toPrimitives() {
    return {
      productoId: this.productoId,
      codigo: this.codigo,
      serie: this.serie,
    };
  }
}
