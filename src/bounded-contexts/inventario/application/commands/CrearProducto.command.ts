export class CrearProductoCommand {
  constructor(
    public readonly codigo: string,
    public readonly nombre: string,
    public readonly marca: string,
    public readonly modelo: string,
    public readonly material: string | null,
    public readonly fotoUrl: string | null,
    public readonly precioCosto: number,
    public readonly precioVenta: number,
    public readonly serieId: string,
    public readonly tallas: {
      tallaId: string;
      stockInicial: number;
      stockMinimo: number;
    }[],
  ) {}
}
