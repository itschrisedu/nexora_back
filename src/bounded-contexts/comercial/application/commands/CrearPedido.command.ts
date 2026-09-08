import { CanalEntrada, TipoPago, TipoVenta, TipoEntrega, AsumeFlete } from '@prisma/client';

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
    public readonly tipoEntrega?: TipoEntrega,
    public readonly asumeFlete?: AsumeFlete,
    public readonly costoEnvio?: number,
    public readonly guiaEnvio?: string,
    public readonly courier?: string,
    public readonly direccionEnvio?: string,
    public readonly ciudadEnvio?: string,
  ) {}
}
