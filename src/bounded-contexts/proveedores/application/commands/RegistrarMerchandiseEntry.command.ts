export interface MerchandiseEntryLineDto {
  productId: string;
  tallaId: string;
  cantidadIngresada: number;
  precioCosto: number;
}

export class RegistrarMerchandiseEntryCommand {
  constructor(
    public readonly supplierId: string,
    public readonly lines: MerchandiseEntryLineDto[],
    public readonly supplierOrderId?: string,
  ) {}
}
