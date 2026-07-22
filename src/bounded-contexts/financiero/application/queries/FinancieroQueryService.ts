import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { CobroEstado, DeudaEstado } from '@prisma/client';

@Injectable()
export class FinancieroQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Cobros ─────────────────────────────────

  async obtenerCobro(cobroId: string) {
    const cobro = await this.prisma.cobro.findUnique({
      where: { id: cobroId },
      include: { abonos: { orderBy: { createdAt: 'asc' } }, saleNote: true },
    });
    if (!cobro) throw new NotFoundException(`Cobro ${cobroId} no encontrado`);
    return cobro;
  }

  async listarCobrosCliente(clientId: string, tenantId?: string | null) {
    const where: any = { clientId };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.cobro.findMany({
      where,
      include: { saleNote: { select: { numero: true, total: true, pdfUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listarCobrosVencidos(tenantId?: string | null) {
    const where: any = {
      fechaVencimiento: { lt: new Date() },
      estado: { not: CobroEstado.SALDADO },
    };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.cobro.findMany({
      where,
      include: { saleNote: true },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }

  async listarCobrosProximosAVencer(diasAntelacion: number = 7, tenantId?: string | null) {
    const limite = new Date();
    limite.setDate(limite.getDate() + diasAntelacion);
    const where: any = {
      fechaVencimiento: { gte: new Date(), lte: limite },
      estado: { not: CobroEstado.SALDADO },
    };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.cobro.findMany({
      where,
      include: { saleNote: true },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }

  // ── Notas de Venta ─────────────────────────

  async obtenerNotaVenta(saleNoteId: string) {
    const nota = await this.prisma.saleNote.findUnique({
      where: { id: saleNoteId },
      include: { lines: true, cobro: true },
    });
    if (!nota) throw new NotFoundException(`Nota de Venta ${saleNoteId} no encontrada`);
    return nota;
  }

  async listarNotasVentaCliente(clientId: string, tenantId?: string | null) {
    const where: any = { clientId };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.saleNote.findMany({
      where,
      include: { cobro: { select: { estado: true, tipo: true, saldoPendiente: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resumenFinanciero(tenantId?: string | null) {
    const filter: any = tenantId ? { tenantId } : {};
    const [totalCobros, cobrosVencidos, cobrosPendientes, deudas] = await Promise.all([
      this.prisma.cobro.aggregate({
        where: filter,
        _sum: { montoTotal: true },
      }),
      this.prisma.cobro.count({
        where: {
          fechaVencimiento: { lt: new Date() },
          estado: { not: CobroEstado.SALDADO },
          ...filter,
        },
      }),
      this.prisma.cobro.aggregate({
        where: {
          estado: { not: CobroEstado.SALDADO },
          ...filter,
        },
        _sum: { saldoPendiente: true },
      }),
      this.prisma.deudaProveedor.aggregate({
        where: {
          estado: { not: DeudaEstado.SALDADO },
          ...filter,
        },
        _sum: { saldoPendiente: true },
      }),
    ]);

    return {
      totalFacturado: Number(totalCobros._sum.montoTotal ?? 0),
      saldoPendienteClientes: Number(cobrosPendientes._sum.saldoPendiente ?? 0),
      cobrosVencidos,
      deudaProveedoresPendiente: Number(deudas._sum.saldoPendiente ?? 0),
    };
  }

  // ── Deudas Proveedor ───────────────────────

  async obtenerDeudaProveedor(deudaId: string) {
    const deuda = await this.prisma.deudaProveedor.findUnique({
      where: { id: deudaId },
      include: { pagos: { orderBy: { createdAt: 'asc' } } },
    });
    if (!deuda) throw new NotFoundException(`Deuda de proveedor ${deudaId} no encontrada`);
    return deuda;
  }

  async listarDeudasProveedor(supplierId?: string, tenantId?: string | null) {
    const where: any = {};
    if (supplierId) where.supplierId = supplierId;
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.deudaProveedor.findMany({
      where,
      include: { pagos: true },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }

  async listarDeudasVencidas(tenantId?: string | null) {
    const where: any = {
      fechaVencimiento: { lt: new Date() },
      estado: { not: DeudaEstado.SALDADO },
    };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.deudaProveedor.findMany({
      where,
      orderBy: { fechaVencimiento: 'asc' },
    });
  }
}
