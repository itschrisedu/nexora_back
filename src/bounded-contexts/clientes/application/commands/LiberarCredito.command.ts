export class LiberarCreditoCommand {
  constructor(
    public readonly clienteId: string,
    public readonly monto: number,
  ) {}
}
