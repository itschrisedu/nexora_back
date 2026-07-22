import { CanalEntrada, TipoPago, TipoVenta } from '@prisma/client';

export interface LineaPedidoInput {
  productId: string;
  tallaId: string;
  cantidad: number;
  tipoVenta: TipoVenta;
}

export class CrearPedidoCommand {
  constructor(
    public readonly clientId: string,
    public readonly canal: CanalEntrada,
    public readonly tipoPago: TipoPago,
    public readonly lineas: LineaPedidoInput[],
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly notas?: string,
  ) {}
}
