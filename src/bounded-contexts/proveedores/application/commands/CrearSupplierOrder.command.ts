export interface CrearSupplierOrderLineDto {
  productId: string;
  cantidadPedida: number;
  precioCosto: number;
  observacionLinea?: string;
}

export class CrearSupplierOrderCommand {
  constructor(
    public readonly supplierId: string,
    public readonly lines: CrearSupplierOrderLineDto[],
    public readonly observaciones?: string,
    public readonly estado?: 'BORRADOR' | 'PENDIENTE',
  ) {}
}
