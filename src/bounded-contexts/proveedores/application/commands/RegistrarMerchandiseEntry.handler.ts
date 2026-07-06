import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { IMerchandiseEntryRepository } from '../../domain/IMerchandiseEntryRepository';
import { ISupplierRepository } from '../../domain/ISupplierRepository';
import { ISupplierOrderRepository } from '../../domain/ISupplierOrderRepository';
import { MerchandiseEntry } from '../../domain/MerchandiseEntry';
import { RegistrarMerchandiseEntryCommand } from './RegistrarMerchandiseEntry.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';

@Injectable()
export class RegistrarMerchandiseEntryHandler {
  constructor(
    @Inject('IMerchandiseEntryRepository')
    private readonly entryRepository: IMerchandiseEntryRepository,
    @Inject('ISupplierRepository')
    private readonly supplierRepository: ISupplierRepository,
    @Inject('ISupplierOrderRepository')
    private readonly orderRepository: ISupplierOrderRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: RegistrarMerchandiseEntryCommand): Promise<string> {
    // 1. Validar proveedor
    const supplier = await this.supplierRepository.findById(command.supplierId);
    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID "${command.supplierId}" no encontrado.`);
    }

    // 2. Si hay orden de compra, validarla y marcar como RECIBIDA
    if (command.supplierOrderId) {
      const order = await this.orderRepository.findById(command.supplierOrderId);
      if (!order) {
        throw new NotFoundException(`Orden de compra con ID "${command.supplierOrderId}" no encontrada.`);
      }
      if (order.supplierId !== command.supplierId) {
        throw new BadRequestException('El proveedor de la orden no coincide con el proveedor del ingreso.');
      }
      order.marcarComoRecibida();
      await this.orderRepository.update(order);
      this.eventBus.publishAll(order.clearDomainEvents());
    }

    // 3. Obtener correlativo de la secuencia merchandise_entry_seq
    const seqResult = await this.prisma.$queryRaw<[{ nextval: bigint }]>`
      SELECT nextval('merchandise_entry_seq')
    `;
    const numero = Number(seqResult[0].nextval);

    const entryId = crypto.randomUUID();
    const entry = MerchandiseEntry.crear(
      entryId,
      numero,
      command.supplierId,
      command.lines.map((l) => ({
        id: crypto.randomUUID(),
        productId: l.productId,
        tallaId: l.tallaId,
        cantidadIngresada: l.cantidadIngresada,
        precioCosto: l.precioCosto,
      })),
      command.supplierOrderId,
    );

    await this.entryRepository.save(entry);

    // Publicar eventos (MerchandiseEntryRegistradaEvent)
    this.eventBus.publishAll(entry.clearDomainEvents());

    return entry.id;
  }
}
