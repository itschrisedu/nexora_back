export class ComprometerCreditoCommand {
  constructor(
    public readonly clienteId: string,
    public readonly monto: number,
  ) {}
}
