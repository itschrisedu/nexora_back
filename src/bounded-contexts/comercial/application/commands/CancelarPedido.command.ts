export class CancelarPedidoCommand {
  constructor(
    public readonly pedidoId: string,
    public readonly motivo: string,
  ) {}
}
