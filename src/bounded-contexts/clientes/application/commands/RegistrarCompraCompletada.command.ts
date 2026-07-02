export class RegistrarCompraCompletadaCommand {
  constructor(
    public readonly clienteId: string,
    public readonly monto: number,
    public readonly esCredito: boolean,
  ) {}
}
