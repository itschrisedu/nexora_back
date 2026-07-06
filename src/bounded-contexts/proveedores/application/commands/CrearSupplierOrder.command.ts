export interface CrearSupplierOrderLineDto {
  productId: string;
  cantidadPedida: number;
  precioCosto: number;
}

export class CrearSupplierOrderCommand {
  constructor(
    public readonly supplierId: string,
    public readonly lines: CrearSupplierOrderLineDto[],
  ) {}
}
