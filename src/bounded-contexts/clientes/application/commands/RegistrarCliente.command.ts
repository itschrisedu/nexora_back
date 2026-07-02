export class RegistrarClienteCommand {
  constructor(
    public readonly nombre: string,
    public readonly apellido: string,
    public readonly telefono: string,
    public readonly email: string | null,
    public readonly ruc: string | null,
    public readonly cedula: string | null,
    public readonly direccion: string | null,
    public readonly notas: string | null,
  ) {}
}
