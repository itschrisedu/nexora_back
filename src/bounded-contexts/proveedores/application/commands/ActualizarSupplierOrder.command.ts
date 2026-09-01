import { CrearSupplierOrderLineDto } from './CrearSupplierOrder.command';

export class ActualizarSupplierOrderCommand {
  constructor(
    public readonly orderId: string,
    public readonly lines?: CrearSupplierOrderLineDto[],
    public readonly observaciones?: string,
    public readonly estado?: 'BORRADOR' | 'PENDIENTE' | 'CANCELADA',
  ) {}
}
