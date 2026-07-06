export class RegistrarSupplierCommand {
  constructor(
    public readonly ruc: string,
    public readonly razonSocial: string,
    public readonly contacto?: string,
    public readonly direccion?: string,
    public readonly email?: string,
  ) {}
}
