import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { IMerchandiseEntryRepository } from '../domain/IMerchandiseEntryRepository';
import { MerchandiseEntry, MerchandiseEntryLineProps } from '../domain/MerchandiseEntry';

@Injectable()
export class PrismaMerchandiseEntryRepository extends IMerchandiseEntryRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<MerchandiseEntry | null> {
    const raw = await this.prisma.merchandiseEntry.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async findByNumero(numero: number): Promise<MerchandiseEntry | null> {
    const raw = await this.prisma.merchandiseEntry.findUnique({
      where: { numero },
      include: { lines: true },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async save(entry: MerchandiseEntry): Promise<void> {
    await this.prisma.merchandiseEntry.create({
      data: {
        id: entry.id,
        numero: entry.numero,
        supplierOrderId: entry.supplierOrderId,
        supplierId: entry.supplierId,
        total: entry.total,
        fechaIngreso: entry.fechaIngreso,
        observaciones: entry.observaciones,
        estado: entry.estado,
        lines: {
          create: entry.lines.map((l) => ({
            id: l.id,
            productId: l.productId,
            tallaId: l.tallaId,
            cantidadIngresada: l.cantidadIngresada,
            cantidadEsperada: l.cantidadEsperada,
            diferencia: l.diferencia,
            precioCosto: l.precioCosto,
            subtotal: l.subtotal,
            observacionLinea: l.observacionLinea,
          })),
        },
      },
    });
  }

  async listBySupplier(supplierId: string): Promise<MerchandiseEntry[]> {
    const raws = await this.prisma.merchandiseEntry.findMany({
      where: { supplierId },
      include: { lines: true },
      orderBy: { fechaIngreso: 'desc' },
    });
    return raws.map((r) => this.toDomain(r));
  }

  async listAll(): Promise<MerchandiseEntry[]> {
    const raws = await this.prisma.merchandiseEntry.findMany({
      include: { lines: true },
      orderBy: { fechaIngreso: 'desc' },
    });
    return raws.map((r) => this.toDomain(r));
  }

  private toDomain(raw: any): MerchandiseEntry {
    const lines: MerchandiseEntryLineProps[] = raw.lines.map((l: any) => ({
      id: l.id,
      productId: l.productId,
      tallaId: l.tallaId,
      cantidadIngresada: l.cantidadIngresada,
      cantidadEsperada: l.cantidadEsperada ?? undefined,
      diferencia: l.diferencia ?? undefined,
      precioCosto: Number(l.precioCosto),
      subtotal: Number(l.subtotal),
      observacionLinea: l.observacionLinea ?? undefined,
    }));

    return MerchandiseEntry.reconstruir(
      raw.id,
      raw.numero,
      raw.supplierOrderId,
      raw.supplierId,
      Number(raw.total),
      lines,
      raw.observaciones,
      raw.estado || 'COMPLETA',
      raw.fechaIngreso,
    );
  }
}
