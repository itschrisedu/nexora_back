import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { ICobroRepository } from '../domain/ICobroRepository';
import { Cobro, AbonoProps } from '../domain/Cobro';
import { Money } from '../../../shared/domain/Money';

@Injectable()
export class PrismaCobroRepository implements ICobroRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Cobro | null> {
    const raw = await this.prisma.cobro.findUnique({
      where: { id },
      include: { abonos: true },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async findBySaleNoteId(saleNoteId: string): Promise<Cobro | null> {
    const raw = await this.prisma.cobro.findUnique({
      where: { saleNoteId },
      include: { abonos: true },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async findByClientId(clientId: string): Promise<Cobro[]> {
    const raws = await this.prisma.cobro.findMany({
      where: { clientId },
      include: { abonos: true },
      orderBy: { createdAt: 'desc' },
    });
    return raws.map((r) => this.toDomain(r));
  }

  async findVencidos(): Promise<Cobro[]> {
    const raws = await this.prisma.cobro.findMany({
      where: {
        fechaVencimiento: { lt: new Date() },
        estado: { not: 'SALDADO' },
      },
      include: { abonos: true },
    });
    return raws.map((r) => this.toDomain(r));
  }

  async findProximosAVencer(diasAntelacion: number): Promise<Cobro[]> {
    const limite = new Date();
    limite.setDate(limite.getDate() + diasAntelacion);
    const raws = await this.prisma.cobro.findMany({
      where: {
        fechaVencimiento: { gte: new Date(), lte: limite },
        estado: { not: 'SALDADO' },
      },
      include: { abonos: true },
    });
    return raws.map((r) => this.toDomain(r));
  }

  async save(cobro: Cobro, tenantId?: string): Promise<void> {
    await this.prisma.cobro.create({
      data: {
        id: cobro.id,
        tenantId: tenantId!,
        saleNoteId: cobro.saleNoteId,
        clientId: cobro.clientId,
        tipo: cobro.tipo,
        montoTotal: cobro.montoTotal.amount,
        saldoPendiente: cobro.saldoPendiente.amount,
        fechaVencimiento: cobro.fechaVencimiento ?? undefined,
        estado: cobro.estado,
      },
    });
  }

  async update(cobro: Cobro): Promise<void> {
    await this.prisma.cobro.update({
      where: { id: cobro.id },
      data: {
        saldoPendiente: cobro.saldoPendiente.amount,
        estado: cobro.estado,
      },
    });

    // Persistir nuevos abonos
    for (const abono of cobro.abonos) {
      const existe = await this.prisma.cobroAbono.findUnique({ where: { id: abono.id } });
      if (!existe) {
        await this.prisma.cobroAbono.create({
          data: {
            id: abono.id,
            cobroId: abono.cobroId,
            monto: abono.monto.amount,
            metodo: abono.metodo,
            notas: abono.notas,
            userId: abono.userId,
          },
        });
      }
    }
  }

  private toDomain(raw: any): Cobro {
    const abonos: AbonoProps[] = (raw.abonos ?? []).map((a: any) => ({
      id: a.id,
      cobroId: a.cobroId,
      monto: Money.create(Number(a.monto)),
      metodo: a.metodo,
      notas: a.notas ?? undefined,
      userId: a.userId,
      createdAt: a.createdAt,
    }));

    return Cobro.reconstruir(
      raw.id,
      raw.saleNoteId,
      raw.clientId,
      raw.tipo,
      Money.create(Number(raw.montoTotal)),
      Money.create(Number(raw.saldoPendiente)),
      raw.estado,
      abonos,
      raw.fechaVencimiento,
      raw.createdAt,
    );
  }
}
