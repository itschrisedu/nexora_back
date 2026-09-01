export class RegistrarSupplierPaymentCommand {
  constructor(
    public readonly supplierId: string,
    public readonly monto: number,
    public readonly metodo: string,
    public readonly comprobante?: string,
    public readonly banco?: string,
    public readonly notas?: string,
    public readonly supplierOrderId?: string,
  ) {}
}
