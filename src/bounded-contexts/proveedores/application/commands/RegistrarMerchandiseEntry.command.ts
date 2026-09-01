export interface MerchandiseEntryLineDto {
  productId: string;
  tallaId: string;
  cantidadIngresada: number;
  cantidadEsperada?: number;
  diferencia?: number;
  precioCosto: number;
  observacionLinea?: string;
}

export class RegistrarMerchandiseEntryCommand {
  constructor(
    public readonly supplierId: string,
    public readonly lines: MerchandiseEntryLineDto[],
    public readonly supplierOrderId?: string,
    public readonly observaciones?: string,
    public readonly estado?: string,
  ) {}
}
