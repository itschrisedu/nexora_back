import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { IDeudaProveedorRepository } from '../domain/IDeudaProveedorRepository';
import { DeudaProveedor, PagoProveedorProps } from '../domain/DeudaProveedor';
import { Money } from '../../../shared/domain/Money';

@Injectable()
export class PrismaDeudaProveedorRepository implements IDeudaProveedorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<DeudaProveedor | null> {
    const raw = await this.prisma.deudaProveedor.findUnique({
      where: { id },
      include: { pagos: true },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async findByEntradaId(entradaId: string): Promise<DeudaProveedor | null> {
    const raw = await this.prisma.deudaProveedor.findUnique({
      where: { entradaId },
      include: { pagos: true },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async findBySupplierId(supplierId: string): Promise<DeudaProveedor[]> {
    const raws = await this.prisma.deudaProveedor.findMany({
      where: { supplierId },
      include: { pagos: true },
      orderBy: { fechaVencimiento: 'asc' },
    });
    return raws.map((r) => this.toDomain(r));
  }

  async findPendientes(): Promise<DeudaProveedor[]> {
    const raws = await this.prisma.deudaProveedor.findMany({
      where: { estado: { not: 'SALDADO' } },
      include: { pagos: true },
      orderBy: { fechaVencimiento: 'asc' },
    });
    return raws.map((r) => this.toDomain(r));
  }

  async findProximasAVencer(diasAntelacion: number): Promise<DeudaProveedor[]> {
    const limite = new Date();
    limite.setDate(limite.getDate() + diasAntelacion);
    const raws = await this.prisma.deudaProveedor.findMany({
      where: {
        fechaVencimiento: { gte: new Date(), lte: limite },
        estado: { not: 'SALDADO' },
      },
      include: { pagos: true },
    });
    return raws.map((r) => this.toDomain(r));
  }

  async save(deuda: DeudaProveedor): Promise<void> {
    await this.prisma.deudaProveedor.create({
      data: {
        id: deuda.id,
        supplierId: deuda.supplierId,
        entradaId: deuda.entradaId,
        montoTotal: deuda.montoTotal.amount,
        saldoPendiente: deuda.saldoPendiente.amount,
        fechaVencimiento: deuda.fechaVencimiento,
        estado: deuda.estado,
      },
    });
  }

  async update(deuda: DeudaProveedor): Promise<void> {
    await this.prisma.deudaProveedor.update({
      where: { id: deuda.id },
      data: {
        saldoPendiente: deuda.saldoPendiente.amount,
        estado: deuda.estado,
      },
    });

    // Persistir nuevos pagos
    for (const pago of deuda.pagos) {
      const existe = await this.prisma.deudaPago.findUnique({ where: { id: pago.id } });
      if (!existe) {
        await this.prisma.deudaPago.create({
          data: {
            id: pago.id,
            deudaId: pago.deudaId,
            monto: pago.monto.amount,
            metodo: pago.metodo,
            notas: pago.notas,
            userId: pago.userId,
          },
        });
      }
    }
  }

  private toDomain(raw: any): DeudaProveedor {
    const pagos: PagoProveedorProps[] = (raw.pagos ?? []).map((p: any) => ({
      id: p.id,
      deudaId: p.deudaId,
      monto: Money.create(Number(p.monto)),
      metodo: p.metodo,
      notas: p.notas ?? undefined,
      userId: p.userId,
      createdAt: p.createdAt,
    }));

    return DeudaProveedor.reconstruir(
      raw.id,
      raw.supplierId,
      raw.entradaId,
      Money.create(Number(raw.montoTotal)),
      Money.create(Number(raw.saldoPendiente)),
      raw.fechaVencimiento,
      raw.estado,
      pagos,
      raw.createdAt,
    );
  }
}
