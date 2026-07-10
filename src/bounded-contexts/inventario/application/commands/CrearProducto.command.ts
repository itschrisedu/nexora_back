export class CrearModeloCommand {
  constructor(
    public readonly baseCode: string,
    public readonly name: string,
    public readonly brand: string,
    public readonly material: string | null,
    public readonly costPrice: number,
    public readonly salePrice: number,
    public readonly colors: {
      color: string;
      imageUrl: string | null;
    }[],
    public readonly serieIds: string[],
    public readonly stockInicial: number = 1,
    public readonly stockMinimo: number = 0,
  ) {}
}
