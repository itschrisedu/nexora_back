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

  async listarCobrosCliente(clientId: string) {
    return this.prisma.cobro.findMany({
      where: { clientId },
      include: { saleNote: { select: { numero: true, total: true, pdfUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listarCobrosVencidos() {
    return this.prisma.cobro.findMany({
      where: {
        fechaVencimiento: { lt: new Date() },
        estado: { not: CobroEstado.SALDADO },
      },
      include: { saleNote: true },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }

  async listarCobrosProximosAVencer(diasAntelacion: number = 7) {
    const limite = new Date();
    limite.setDate(limite.getDate() + diasAntelacion);
    return this.prisma.cobro.findMany({
      where: {
        fechaVencimiento: { gte: new Date(), lte: limite },
        estado: { not: CobroEstado.SALDADO },
      },
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

  async listarNotasVentaCliente(clientId: string) {
    return this.prisma.saleNote.findMany({
      where: { clientId },
      include: { cobro: { select: { estado: true, tipo: true, saldoPendiente: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resumenFinanciero() {
    const [totalCobros, cobrosVencidos, cobrosPendientes, deudas] = await Promise.all([
      this.prisma.cobro.aggregate({ _sum: { montoTotal: true } }),
      this.prisma.cobro.count({
        where: { fechaVencimiento: { lt: new Date() }, estado: { not: CobroEstado.SALDADO } },
      }),
      this.prisma.cobro.aggregate({
        where: { estado: { not: CobroEstado.SALDADO } },
        _sum: { saldoPendiente: true },
      }),
      this.prisma.deudaProveedor.aggregate({
        where: { estado: { not: DeudaEstado.SALDADO } },
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

  async listarDeudasProveedor(supplierId?: string) {
    return this.prisma.deudaProveedor.findMany({
      where: supplierId ? { supplierId } : undefined,
      include: { pagos: true },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }

  async listarDeudasVencidas() {
    return this.prisma.deudaProveedor.findMany({
      where: {
        fechaVencimiento: { lt: new Date() },
        estado: { not: DeudaEstado.SALDADO },
      },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }
}
