import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { CreateGastoDto, UpdateGastoDto, GastoFiltrosDto } from './dto/gastos.dto';
import { GastoCategoria, MetodoPagoGasto } from '@prisma/client';

@Injectable()
export class GastosService {
  private readonly logger = new Logger(GastosService.name);

  constructor(private readonly prisma: PrismaService) {}

  async crearGasto(tenantId: string, userId: string, dto: CreateGastoDto) {
    const targetTenantId = dto.sucursalId || tenantId;

    const gasto = await this.prisma.gasto.create({
      data: {
        tenantId: targetTenantId,
        userId,
        orderId: dto.orderId || null,
        categoria: dto.categoria,
        concepto: dto.concepto,
        monto: dto.monto,
        metodoPago: dto.metodoPago || MetodoPagoGasto.EFECTIVO,
        fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
        numeroComprobante: dto.numeroComprobante || null,
        proveedorServicio: dto.proveedorServicio || null,
        comprobanteUrl: dto.comprobanteUrl || null,
        observaciones: dto.observaciones || null,
      },
      include: {
        user: { select: { id: true, nombre: true, email: true } },
        order: { select: { id: true, tipoPago: true, montoTotal: true } },
        tenant: {
          select: {
            id: true,
            name: true,
            businessConfig: { select: { nombre: true } },
          },
        },
      },
    });

    this.logger.log(`Gasto registrado: ${gasto.id} - ${dto.concepto} ($${dto.monto})`);
    return this.formatearGasto(gasto);
  }

  async listarGastos(tenantId: string, filtros?: GastoFiltrosDto) {
    const where: any = {};

    if (filtros?.sucursalId) {
      where.tenantId = filtros.sucursalId;
    } else if (tenantId) {
      where.tenantId = tenantId;
    }

    if (filtros?.categoria) {
      where.categoria = filtros.categoria;
    }

    if (filtros?.metodoPago) {
      where.metodoPago = filtros.metodoPago;
    }

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fecha = {};
      if (filtros.fechaDesde) where.fecha.gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta) {
        const hasta = new Date(filtros.fechaHasta);
        hasta.setHours(23, 59, 59, 999);
        where.fecha.lte = hasta;
      }
    } else if (filtros?.mes !== undefined && filtros?.anio !== undefined) {
      const mesNum = Number(filtros.mes);
      const anioNum = Number(filtros.anio);
      const inicioMes = new Date(anioNum, mesNum, 1);
      const finMes = new Date(anioNum, mesNum + 1, 0, 23, 59, 59, 999);
      where.fecha = { gte: inicioMes, lte: finMes };
    }

    const gastos = await this.prisma.gasto.findMany({
      where,
      orderBy: { fecha: 'desc' },
      include: {
        user: { select: { id: true, nombre: true, email: true } },
        order: { select: { id: true, tipoPago: true, montoTotal: true } },
        tenant: {
          select: {
            id: true,
            name: true,
            businessConfig: { select: { nombre: true } },
          },
        },
      },
    });

    return gastos.map((g) => this.formatearGasto(g));
  }

  async obtenerEstadisticasGastos(tenantId: string, mes?: number, anio?: number, sucursalId?: string) {
    const now = new Date();
    const currentMonth = mes !== undefined ? Number(mes) : now.getMonth();
    const currentYear = anio !== undefined ? Number(anio) : now.getFullYear();

    const inicioMes = new Date(currentYear, currentMonth, 1);
    const finMes = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

    // Mes anterior para comparar crecimiento
    const inicioMesAnterior = new Date(currentYear, currentMonth - 1, 1);
    const finMesAnterior = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

    const whereMes: any = {
      fecha: { gte: inicioMes, lte: finMes },
    };
    const whereMesAnterior: any = {
      fecha: { gte: inicioMesAnterior, lte: finMesAnterior },
    };

    if (sucursalId) {
      whereMes.tenantId = sucursalId;
      whereMesAnterior.tenantId = sucursalId;
    } else if (tenantId) {
      whereMes.tenantId = tenantId;
      whereMesAnterior.tenantId = tenantId;
    }

    const [gastosMes, gastosMesAnterior] = await Promise.all([
      this.prisma.gasto.findMany({ where: whereMes }),
      this.prisma.gasto.findMany({ where: whereMesAnterior }),
    ]);

    const totalMes = gastosMes.reduce((acc, g) => acc + Number(g.monto), 0);
    const totalMesAnterior = gastosMesAnterior.reduce((acc, g) => acc + Number(g.monto), 0);

    // Desglose por categoría
    const porCategoriaMap = new Map<string, { categoria: string; total: number; cantidad: number }>();
    Object.values(GastoCategoria).forEach((cat) => {
      porCategoriaMap.set(cat, { categoria: cat, total: 0, cantidad: 0 });
    });

    gastosMes.forEach((g) => {
      const item = porCategoriaMap.get(g.categoria) || { categoria: g.categoria, total: 0, cantidad: 0 };
      item.total += Number(g.monto);
      item.cantidad += 1;
      porCategoriaMap.set(g.categoria, item);
    });

    const porCategoria = Array.from(porCategoriaMap.values())
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);

    // Desglose por método de pago
    const porMetodoMap = new Map<string, number>();
    gastosMes.forEach((g) => {
      const val = porMetodoMap.get(g.metodoPago) || 0;
      porMetodoMap.set(g.metodoPago, val + Number(g.monto));
    });

    const porMetodo = Array.from(porMetodoMap.entries()).map(([metodo, total]) => ({
      metodo,
      total,
    }));

    // Variación %
    let variacionPorcentual = 0;
    if (totalMesAnterior > 0) {
      variacionPorcentual = ((totalMes - totalMesAnterior) / totalMesAnterior) * 100;
    }

    return {
      mes: currentMonth,
      anio: currentYear,
      totalMes: Number(totalMes.toFixed(2)),
      totalMesAnterior: Number(totalMesAnterior.toFixed(2)),
      variacionPorcentual: Number(variacionPorcentual.toFixed(1)),
      cantidadGastos: gastosMes.length,
      porCategoria,
      porMetodo,
    };
  }

  async obtenerGastoPorId(id: string, tenantId?: string) {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;

    const gasto = await this.prisma.gasto.findUnique({
      where,
      include: {
        user: { select: { id: true, nombre: true, email: true } },
        order: { select: { id: true, tipoPago: true, montoTotal: true } },
        tenant: {
          select: {
            id: true,
            name: true,
            businessConfig: { select: { nombre: true } },
          },
        },
      },
    });

    if (!gasto) {
      throw new NotFoundException(`Gasto con ID "${id}" no encontrado`);
    }

    return this.formatearGasto(gasto);
  }

  async actualizarGasto(id: string, tenantId: string, dto: UpdateGastoDto) {
    const existing = await this.prisma.gasto.findUnique({
      where: { id },
    });

    if (!existing || (tenantId && existing.tenantId !== tenantId)) {
      throw new NotFoundException(`Gasto con ID "${id}" no encontrado o no pertenece a la sucursal`);
    }

    const data: any = { ...dto };
    if (dto.fecha) data.fecha = new Date(dto.fecha);

    const updated = await this.prisma.gasto.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, nombre: true, email: true } },
        order: { select: { id: true, tipoPago: true, montoTotal: true } },
        tenant: {
          select: {
            id: true,
            name: true,
            businessConfig: { select: { nombre: true } },
          },
        },
      },
    });

    return this.formatearGasto(updated);
  }

  async eliminarGasto(id: string, tenantId?: string) {
    const existing = await this.prisma.gasto.findUnique({ where: { id } });
    if (!existing || (tenantId && existing.tenantId !== tenantId)) {
      throw new NotFoundException(`Gasto con ID "${id}" no encontrado`);
    }

    await this.prisma.gasto.delete({ where: { id } });
    this.logger.log(`Gasto eliminado: ${id}`);
    return { success: true, message: 'Gasto eliminado exitosamente' };
  }

  private formatearGasto(g: any) {
    return {
      id: g.id,
      tenantId: g.tenantId,
      sucursalNombre: g.tenant?.businessConfig?.nombre || g.tenant?.name || 'Matriz',
      categoria: g.categoria,
      concepto: g.concepto,
      monto: Number(g.monto),
      metodoPago: g.metodoPago,
      fecha: g.fecha,
      numeroComprobante: g.numeroComprobante,
      proveedorServicio: g.proveedorServicio,
      comprobanteUrl: g.comprobanteUrl,
      observaciones: g.observaciones,
      orderId: g.orderId,
      userId: g.userId,
      usuarioNombre: g.user?.nombre || g.user?.email || 'Sistema',
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }
}
