import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ISupplierOrderRepository } from '../../domain/ISupplierOrderRepository';
import { ISupplierRepository } from '../../domain/ISupplierRepository';
import { SupplierOrder } from '../../domain/SupplierOrder';
import { CrearSupplierOrderCommand } from './CrearSupplierOrder.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class CrearSupplierOrderHandler {
  constructor(
    @Inject('ISupplierOrderRepository')
    private readonly orderRepository: ISupplierOrderRepository,
    @Inject('ISupplierRepository')
    private readonly supplierRepository: ISupplierRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CrearSupplierOrderCommand): Promise<string> {
    // 1. Validar que el proveedor exista
    const supplier = await this.supplierRepository.findById(command.supplierId);
    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID "${command.supplierId}" no encontrado.`);
    }

    // 2. Obtener correlativo de la secuencia supplier_order_seq
    const seqResult = await this.prisma.$queryRaw<[{ nextval: bigint }]>`
      SELECT nextval('supplier_order_seq')
    `;
    const numero = Number(seqResult[0].nextval);

    const orderId = crypto.randomUUID();
    const order = SupplierOrder.crear(
      orderId,
      numero,
      command.supplierId,
      command.lines.map((l) => ({
        id: crypto.randomUUID(),
        productId: l.productId,
        cantidadPedida: l.cantidadPedida,
        precioCosto: l.precioCosto,
      })),
    );

    await this.orderRepository.save(order);

    // Publicar eventos
    this.eventBus.publishAll(order.clearDomainEvents());

    return order.id;
  }
}
