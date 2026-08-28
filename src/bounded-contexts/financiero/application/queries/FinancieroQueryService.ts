import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';
import { CobroEstado, DeudaEstado } from '@prisma/client';

@Injectable()
export class FinancieroQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

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

  async listarTodosCobros(tenantId?: string | null) {
    const where: any = {};
    if (tenantId) where.tenantId = tenantId;

    // 1. Auto-sincronizar pedidos entregados que aún no tengan cobro generado
    try {
      const existingSaleNotes = await this.prisma.saleNote.findMany({
        select: { orderId: true },
      });
      const orderIdsWithSaleNote = new Set(existingSaleNotes.map((s) => s.orderId));

      const pedidosEntregados = await this.prisma.order.findMany({
        where: {
          estado: 'ENTREGADO',
          ...(tenantId ? { tenantId } : {}),
        },
        include: { lines: true },
      });

      const pedidosEntregadosSinCobro = pedidosEntregados.filter(
        (o) => !orderIdsWithSaleNote.has(o.id),
      );

      for (const order of pedidosEntregadosSinCobro) {
        const lastNote = await this.prisma.saleNote.findFirst({
          orderBy: { numero: 'desc' },
          select: { numero: true },
        });
        const numero = (lastNote?.numero || 0) + 1;
        const saleNoteId = crypto.randomUUID();
        const cobroId = crypto.randomUUID();
        const total = Number(order.montoTotal);

        await this.prisma.saleNote.create({
          data: {
            id: saleNoteId,
            tenantId: order.tenantId,
            numero,
            orderId: order.id,
            clientId: order.clientId,
            subtotal: total,
            descuento: 0,
            total,
            pdfUrl: `/storage/notas-venta/nota-venta-${String(numero).padStart(6, '0')}.pdf`,
          },
        });

        const estadoCobro = order.tipoPago === 'CONTADO' ? CobroEstado.SALDADO : CobroEstado.PENDIENTE;
        const saldoPendiente = order.tipoPago === 'CONTADO' ? 0 : total;
        const vencimiento = new Date();
        vencimiento.setDate(vencimiento.getDate() + 30);

        await this.prisma.cobro.create({
          data: {
            id: cobroId,
            tenantId: order.tenantId,
            saleNoteId,
            clientId: order.clientId,
            tipo: order.tipoPago as any,
            montoTotal: total,
            saldoPendiente,
            fechaVencimiento: order.tipoPago === 'CREDITO' ? vencimiento : null,
            estado: estadoCobro,
          },
        });
      }
    } catch (syncErr) {
      // Continuar normalmente
    }

    // 2. Obtener todos los cobros con sus notas de venta y abonos
    const cobros = await this.prisma.cobro.findMany({
      where,
      include: {
        saleNote: {
          select: {
            id: true,
            numero: true,
            total: true,
            subtotal: true,
            descuento: true,
            pdfUrl: true,
            orderId: true,
            createdAt: true,
            lines: true,
          },
        },
        abonos: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const clientIds = [...new Set(cobros.map((c) => c.clientId).filter(Boolean))];
    const clients = await this.prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        cedula: true,
        telefono: true,
        direccion: true,
        nivelCredito: true,
        limiteCredito: true,
        creditoUtilizado: true,
      },
    });

    const clientMap = new Map(
      clients.map((c) => {
        let cedulaDescifrada = c.cedula || '—';
        if (c.cedula) {
          try {
            cedulaDescifrada = this.encryptionService.decrypt(c.cedula);
          } catch (e) {
            cedulaDescifrada = c.cedula;
          }
        }
        return [
          c.id,
          {
            ...c,
            cedula: cedulaDescifrada,
          },
        ];
      }),
    );

    return cobros.map((cobro) => {
      const client = clientMap.get(cobro.clientId);
      return {
        ...cobro,
        clienteNombre: client ? `${client.nombre} ${client.apellido}`.trim() : 'Cliente sin registrar',
        clienteCedula: client?.cedula || '—',
        clienteTelefono: client?.telefono || '—',
        clienteNivel: client?.nivelCredito || '—',
        client,
      };
    });
  }

  async obtenerHistorialCompletoCliente(clientId: string, tenantId?: string | null) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException(`Cliente con ID "${clientId}" no encontrado`);
    }

    let cedulaDescifrada = client.cedula || '—';
    if (client.cedula) {
      try {
        cedulaDescifrada = this.encryptionService.decrypt(client.cedula);
      } catch (e) {
        cedulaDescifrada = client.cedula;
      }
    }

    const whereTenant = tenantId ? { tenantId } : {};

    const [pedidos, notasVenta, cobros] = await Promise.all([
      this.prisma.order.findMany({
        where: { clientId, ...whereTenant },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.saleNote.findMany({
        where: { clientId, ...whereTenant },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cobro.findMany({
        where: { clientId, ...whereTenant },
        include: { abonos: { orderBy: { createdAt: 'desc' } }, saleNote: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Consolidar timeline cronológico de movimientos
    const movimientos: any[] = [];

    // 1. Pedidos / Compras
    pedidos.forEach((p) => {
      movimientos.push({
        id: `pedido-${p.id}`,
        tipo: 'COMPRA_PEDIDO',
        titulo: `Pedido #${p.id.slice(0, 8).toUpperCase()}`,
        descripcion: `Compra por canal ${p.canal} (${p.tipoPago}) - ${p.estado}`,
        monto: Number(p.montoTotal),
        estado: p.estado,
        fecha: p.createdAt,
        detalles: {
          lineasCount: p.lines.length,
          notas: p.notas,
        },
      });
    });

    // 2. Abonos realizados
    cobros.forEach((c) => {
      c.abonos.forEach((a) => {
        movimientos.push({
          id: `abono-${a.id}`,
          tipo: 'ABONO',
          titulo: `Abono a Cobro #${c.saleNote?.numero || c.id.slice(0, 8).toUpperCase()}`,
          descripcion: `Método: ${a.metodo}${a.notas ? ` - ${a.notas}` : ''}`,
          monto: Number(a.monto),
          metodo: a.metodo,
          notas: a.notas,
          fecha: a.createdAt,
        });
      });
    });

    // Ordenar de más reciente a más antiguo
    movimientos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    const totalAbonado = cobros.reduce(
      (sum, c) => sum + c.abonos.reduce((s, a) => s + Number(a.monto), 0),
      0,
    );

    const saldoPendienteTotal = cobros.reduce((sum, c) => sum + Number(c.saldoPendiente), 0);

    return {
      cliente: {
        id: client.id,
        nombre: `${client.nombre} ${client.apellido}`.trim(),
        cedula: cedulaDescifrada,
        telefono: client.telefono,
        email: client.email,
        direccion: client.direccion,
        nivelCredito: client.nivelCredito,
        limiteCredito: Number(client.limiteCredito),
        creditoUtilizado: Number(client.creditoUtilizado),
        totalCompras: client.totalCompras,
        atrasoConsecutivo: client.atrasoConsecutivo,
      },
      resumen: {
        totalPedidos: pedidos.length,
        totalComprado: pedidos.reduce((sum, p) => sum + Number(p.montoTotal), 0),
        saldoPendienteTotal,
        totalAbonado,
      },
      pedidos,
      notasVenta,
      cobros,
      movimientos,
    };
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
