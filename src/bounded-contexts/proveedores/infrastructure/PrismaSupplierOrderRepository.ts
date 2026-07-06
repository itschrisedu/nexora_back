import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { ISupplierOrderRepository } from '../domain/ISupplierOrderRepository';
import { SupplierOrder, SupplierOrderLineProps } from '../domain/SupplierOrder';

@Injectable()
export class PrismaSupplierOrderRepository extends ISupplierOrderRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<SupplierOrder | null> {
    const raw = await this.prisma.supplierOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async findByNumero(numero: number): Promise<SupplierOrder | null> {
    const raw = await this.prisma.supplierOrder.findUnique({
      where: { numero },
      include: { lines: true },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async save(order: SupplierOrder): Promise<void> {
    await this.prisma.supplierOrder.create({
      data: {
        id: order.id,
        numero: order.numero,
        supplierId: order.supplierId,
        total: order.total,
        estado: order.estado,
        lines: {
          create: order.lines.map((l) => ({
            id: l.id,
            productId: l.productId,
            cantidadPedida: l.cantidadPedida,
            precioCosto: l.precioCosto,
            subtotal: l.subtotal,
          })),
        },
      },
    });
  }

  async update(order: SupplierOrder): Promise<void> {
    await this.prisma.supplierOrder.update({
      where: { id: order.id },
      data: {
        estado: order.estado,
      },
    });
  }

  async listBySupplier(supplierId: string): Promise<SupplierOrder[]> {
    const raws = await this.prisma.supplierOrder.findMany({
      where: { supplierId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    return raws.map((r) => this.toDomain(r));
  }

  async listAll(): Promise<SupplierOrder[]> {
    const raws = await this.prisma.supplierOrder.findMany({
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    return raws.map((r) => this.toDomain(r));
  }

  private toDomain(raw: any): SupplierOrder {
    const lines: SupplierOrderLineProps[] = raw.lines.map((l: any) => ({
      id: l.id,
      productId: l.productId,
      cantidadPedida: l.cantidadPedida,
      precioCosto: Number(l.precioCosto),
      subtotal: Number(l.subtotal),
    }));

    return SupplierOrder.reconstruir(
      raw.id,
      raw.numero,
      raw.supplierId,
      Number(raw.total),
      raw.estado,
      lines,
      raw.createdAt,
    );
  }
}
