export class CrearDeudaProveedorCommand {
  constructor(
    public readonly supplierId: string,
    public readonly entradaId: string,
    public readonly montoTotal: number,
    public readonly fechaVencimiento: Date,
  ) {}
}
