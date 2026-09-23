export class ActualizarSupplierCommand {
  constructor(
    public readonly id: string,
    public readonly razonSocial?: string,
    public readonly contacto?: string,
    public readonly direccion?: string,
    public readonly email?: string,
    public readonly activo?: boolean,
  ) {}
}
