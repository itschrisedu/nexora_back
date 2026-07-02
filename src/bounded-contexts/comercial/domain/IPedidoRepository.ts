import { Pedido } from './Pedido';
import { EstadoPedido as PrismaEstadoPedido } from '@prisma/client';

export interface PedidoFilters {
  clientId?: string;
  estado?: PrismaEstadoPedido;
  userId?: string;
}

export abstract class IPedidoRepository {
  abstract findById(id: string): Promise<Pedido | null>;
  abstract findAll(filters?: PedidoFilters): Promise<Pedido[]>;
  abstract save(pedido: Pedido): Promise<void>;
  abstract update(pedido: Pedido): Promise<void>;
}
