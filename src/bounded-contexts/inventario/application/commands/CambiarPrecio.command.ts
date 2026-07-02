export class CambiarPrecioCommand {
  constructor(
    public readonly productoId: string,
    public readonly nuevoPrecioCosto: number,
    public readonly nuevoPrecioVenta: number,
    public readonly userId: string,
    public readonly motivo?: string,
  ) {}
}
