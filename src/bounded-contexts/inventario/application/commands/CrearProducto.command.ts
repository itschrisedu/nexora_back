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
    public readonly tenantId: string | null = null,
    // Precios individuales por serie (opcional, si no se provee usa costPrice/salePrice globales)
    public readonly seriesPrices: Record<string, { costPrice: number; salePrice: number }> | null = null,
    // Tallas personalizadas por serie: { serieId: tallaId[] } — si no se provee, usa TODAS las tallas de la serie
    // Los tallaIds pueden repetirse para indicar stock extra en esa talla
    public readonly customTallas: Record<string, string[]> | null = null,
  ) {}
}
