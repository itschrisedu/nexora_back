export class DescontarStockCommand {
  constructor(
    public readonly productoId: string,
    public readonly tallaId: string,
    public readonly cantidad: number,
    public readonly motivo: string,
    public readonly referenceId: string | null,
    public readonly userId: string,
  ) {}
}
