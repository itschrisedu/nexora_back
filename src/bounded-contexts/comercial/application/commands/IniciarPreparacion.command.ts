export class IniciarPreparacionCommand {
  constructor(
    public readonly pedidoId: string,
    public readonly rol: string,
  ) {}
}
