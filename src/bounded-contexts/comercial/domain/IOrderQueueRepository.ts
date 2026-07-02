import { NivelCredito } from '@prisma/client';

export interface OrderQueueEntry {
  id: string;
  orderId: string;
  clientId: string;
  prioridadFifo: Date;
  nivelCredito: NivelCredito;
  totalHistorico: number;
  activa: boolean;
  activadaAt: Date | null;
  createdAt: Date;
}

export abstract class IOrderQueueRepository {
  abstract findActiveByOrderId(orderId: string): Promise<OrderQueueEntry | null>;
  abstract findActiveOrderByPriority(): Promise<OrderQueueEntry[]>;
  abstract findActiveByProduct(productId: string, tallaId: string): Promise<OrderQueueEntry[]>;
  abstract save(entry: Omit<OrderQueueEntry, 'id' | 'createdAt' | 'activadaAt'>): Promise<string>;
  abstract deactivate(id: string): Promise<void>;
}
