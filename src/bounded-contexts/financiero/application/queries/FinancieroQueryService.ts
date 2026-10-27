import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';
import { CobroEstado, DeudaEstado } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class FinancieroQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  // ── Cobros ─────────────────────────────────

  async obtenerCobro(cobroId: string) {
    const cobro = await this.prisma.cobro.findUnique({
      where: { id: cobroId },
      include: {
        abonos: { orderBy: { createdAt: 'asc' } },
        saleNote: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    if (!cobro) throw new NotFoundException(`Cobro ${cobroId} no encontrado`);

    // Resolver vendedor original (vía Order.userId)
    let vendedor: { nombre: string; email: string; rol: string } | null = null;
    if (cobro.saleNote?.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: cobro.saleNote.orderId },
        select: { userId: true },
      });
      if (order?.userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: order.userId },
          select: { nombre: true, email: true, rol: true },
        });
        if (user) vendedor = { nombre: user.nombre, email: user.email, rol: user.rol };
      }
    }

    // Resolver cajero de cada abono
    const abonoUserIds = cobro.abonos.map((a) => a.userId).filter(Boolean);
    const users = abonoUserIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: abonoUserIds } },
          select: {
            id: true,
            nombre: true,
            email: true,
            rol: true,
            tenantId: true,
            tenant: { select: { id: true, name: true } },
          },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const abonosEnriquecidos = cobro.abonos.map((a) => {
      const cajero = userMap.get(a.userId);
      const sucursalCajero = (cajero as any)?.tenant?.name || 'Administración Central';
      const esOtraSucursal = Boolean(cajero?.tenantId && cobro.tenantId && cajero.tenantId !== cobro.tenantId);
      return {
        ...a,
        usuarioNombre: cajero?.nombre || 'Usuario del sistema',
        usuarioEmail: cajero?.email || '',
        usuarioRol: cajero?.rol || '',
        usuarioSucursal: sucursalCajero,
        esCobroOtraSucursal: esOtraSucursal,
      };
    });

    return {
      ...cobro,
      abonos: abonosEnriquecidos,
      vendedorNombre: vendedor?.nombre || '',
      vendedorEmail: vendedor?.email || '',
      vendedorRol: vendedor?.rol || '',
      sucursalNombre: (cobro as any).tenant?.name || '',
    };
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

    // Auto-sanitización de coherencia: cobros saldados, cancelados o de contado nunca deben retener saldo pendiente
    try {
      await this.prisma.cobro.updateMany({
        where: {
          OR: [
            { estado: CobroEstado.SALDADO },
            { estado: 'CANCELADO' as any },
            { tipo: 'CONTADO' },
          ],
          saldoPendiente: { gt: 0 },
        },
        data: {
          saldoPendiente: 0,
        },
      });
    } catch (cleanErr) {
      // Continuar si la BD no permite update masivo
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
        tenant: {
          select: { id: true, name: true },
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
        ruc: true,
        telefono: true,
        email: true,
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
        let rucDescifrado = c.ruc || '';
        if (c.ruc) {
          try {
            rucDescifrado = this.encryptionService.decrypt(c.ruc);
          } catch (e) {
            rucDescifrado = c.ruc;
          }
        }
        return [
          c.id,
          {
            ...c,
            cedula: cedulaDescifrada,
            ruc: rucDescifrado,
          },
        ];
      }),
    );

    // 3. Resolver vendedor original de cada cobro (vía Order.userId), logística y líneas de calzado
    const orderIds = cobros
      .map((c) => c.saleNote?.orderId)
      .filter(Boolean) as string[];
    const orders = orderIds.length > 0
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            userId: true,
            tipoEntrega: true,
            courier: true,
            guiaEnvio: true,
            direccionEnvio: true,
            ciudadEnvio: true,
            asumeFlete: true,
            costoEnvio: true,
            notas: true,
            lines: true,
          },
        })
      : [];
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const orderUserMap = new Map(orders.map((o) => [o.id, o.userId]));

    // Generar códigos de pedido PED-XXXX consistentes con ComercialQueryService
    const allTenantOrders = await this.prisma.order.findMany({
      where: where.tenantId ? { tenantId: where.tenantId } : {},
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const orderCodigoMap = new Map<string, string>();
    allTenantOrders.forEach((o, idx) => {
      orderCodigoMap.set(o.id, `PED-${String(idx + 1).padStart(4, '0')}`);
    });

    // Obtener información de productos y tallas para las líneas de pedidos y notas de venta
    const allSaleNoteLines = cobros.flatMap((c) => (c.saleNote?.lines as any[]) || []);
    const allOrderLines = orders.flatMap((o) => o.lines || []);
    const productIds = [
      ...new Set([
        ...allOrderLines.map((l) => l.productId),
        ...allSaleNoteLines.map((l) => l.productId),
      ].filter(Boolean)),
    ];
    const products = productIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          include: { model: true, serie: true },
        })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const tallaIds = [...new Set(allOrderLines.map((l) => l.tallaId).filter(Boolean))];
    const tallas = tallaIds.length > 0
      ? await this.prisma.tallaConfig.findMany({
          where: { id: { in: tallaIds } },
          select: { id: true, numero: true },
        })
      : [];
    const tallaMap = new Map(tallas.map((t) => [t.id, t.numero]));

    // Resolver usuarios (vendedores de la orden + cajeros de abonos)
    const abonoUserIds = cobros.flatMap((c) =>
      c.abonos.map((a) => a.userId).filter(Boolean),
    );
    const allUserIds = [
      ...new Set([...orders.map((o) => o.userId), ...abonoUserIds].filter(Boolean)),
    ];
    const users = allUserIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: allUserIds } },
          select: {
            id: true,
            nombre: true,
            email: true,
            rol: true,
            tenantId: true,
            tenant: { select: { id: true, name: true } },
          },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return cobros.map((cobro) => {
      const client = clientMap.get(cobro.clientId);

      // Datos del vendedor original y logística del pedido
      const order = cobro.saleNote?.orderId
        ? orderMap.get(cobro.saleNote.orderId)
        : null;
      const vendedorId = order ? order.userId : null;
      const vendedor = vendedorId ? userMap.get(vendedorId) : null;

      // Líneas de pedido enriquecidas
      const orderLinesEnriched = order?.lines?.map((l) => {
        const prod = productMap.get(l.productId);
        const numTalla = tallaMap.get(l.tallaId);
        return {
          id: l.id,
          productId: l.productId,
          cantidad: l.cantidad,
          precioUnitario: Number(l.precioUnitario),
          subtotal: l.cantidad * Number(l.precioUnitario),
          tipoVenta: l.tipoVenta,
          modelName: prod?.model?.name || 'Calzado',
          color: prod?.color || '',
          imageUrl: prod?.imageUrl || null,
          serieNombre: prod?.serie?.nombre || 'Estándar',
          numeroTalla: numTalla ?? 38,
        };
      }) || [];

      // Consolidar líneas finales
      const finalLines = (cobro.saleNote?.lines && cobro.saleNote.lines.length > 0)
        ? cobro.saleNote.lines.map((l: any) => {
            const prod = productMap.get(l.productId);
            return {
              id: l.id,
              productId: l.productId,
              cantidad: l.cantidad,
              precioUnitario: Number(l.precioUnitario),
              subtotal: Number(l.subtotal ?? (l.cantidad * Number(l.precioUnitario))),
              modelName: prod?.model?.name || l.nombre || 'Calzado',
              color: prod?.color || '',
              imageUrl: prod?.imageUrl || null,
              serieNombre: prod?.serie?.nombre || l.serie || 'Estándar',
              numeroTalla: l.talla || '38',
              tipoVenta: 'POR_TALLA',
            };
          })
        : orderLinesEnriched;

      // Enriquecer abonos con datos del cajero y sucursal
      const abonosEnriquecidos = cobro.abonos.map((a) => {
        const cajero = userMap.get(a.userId);
        const sucursalCajero = (cajero as any)?.tenant?.name || 'Administración Central';
        const esOtraSucursal = Boolean(cajero?.tenantId && cobro.tenantId && cajero.tenantId !== cobro.tenantId);
        return {
          ...a,
          usuarioNombre: cajero?.nombre || 'Usuario del sistema',
          usuarioEmail: cajero?.email || '',
          usuarioRol: cajero?.rol || '',
          usuarioSucursal: sucursalCajero,
          esCobroOtraSucursal: esOtraSucursal,
        };
      });

      const orderId = cobro.saleNote?.orderId || order?.id || null;
      const orderCodigo = orderId
        ? orderCodigoMap.get(orderId) || `PED-${orderId.slice(0, 4).toUpperCase()}`
        : null;

      const saldoLimpio = (cobro.estado === CobroEstado.SALDADO || (cobro.estado as any) === 'CANCELADO' || cobro.tipo === 'CONTADO')
        ? 0
        : Math.max(0, Number(cobro.saldoPendiente || 0));

      return {
        ...cobro,
        saldoPendiente: saldoLimpio,
        orderId,
        orderCodigo,
        orderNumero: orderCodigo,
        saleNote: cobro.saleNote
          ? {
              ...cobro.saleNote,
              orderId,
              orderCodigo,
            }
          : undefined,
        abonos: abonosEnriquecidos,
        clienteNombre: client ? `${client.nombre} ${client.apellido}`.trim() : 'Cliente sin registrar',
        clienteCedula: client?.cedula || client?.ruc || '—',
        clienteTelefono: client?.telefono || '—',
        clienteEmail: client?.email || '',
        clienteDireccion: client?.direccion || '',
        clienteNivel: client?.nivelCredito || '—',
        client,
        vendedorNombre: vendedor?.nombre || '',
        vendedorEmail: vendedor?.email || '',
        vendedorRol: vendedor?.rol || '',
        sucursalNombre: (cobro as any).tenant?.name || '',
        tipoEntrega: order?.tipoEntrega || 'PRESENCIAL',
        courier: order?.courier || null,
        guiaEnvio: order?.guiaEnvio || null,
        direccionEnvio: order?.direccionEnvio || null,
        ciudadEnvio: order?.ciudadEnvio || null,
        asumeFlete: order?.asumeFlete || 'NO_APLICA',
        costoEnvio: order?.costoEnvio ? Number(order.costoEnvio) : 0,
        notasPedido: order?.notas || null,
        lines: finalLines,
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

    const [pedidos, notasVenta, cobros, devolucionesCliente, movsDevolucion] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          clientId,
          estado: { in: ['ENTREGADO', 'ENTREGADO_PARCIAL'] },
          ...whereTenant,
        },
        include: {
          lines: true,
          dispatchOrder: { select: { id: true, confirmadoPorId: true, confirmadoAt: true, estado: true } },
        },
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
      this.prisma.clienteDevolucion.findMany({
        where: { clientId, ...whereTenant },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.movimientoFinanciero.findMany({
        where: {
          clientId,
          tipo: { in: ['DESCUENTO_DEVOLUCION_CLIENTE', 'SALDO_FAVOR_CLIENTE'] },
          ...whereTenant,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Recolectar productos y tallas para formatear las líneas de pedido y devoluciones
    const allLines = [
      ...pedidos.flatMap((p: any) => p.lines || []),
      ...devolucionesCliente.flatMap((d: any) => d.lines || []),
    ];
    const productIds = Array.from(new Set(allLines.map((l) => l.productId).filter(Boolean)));
    const tallaIds = Array.from(new Set(allLines.map((l) => l.tallaId).filter(Boolean)));

    const productMap = new Map<string, any>();
    const tallaMap = new Map<string, number>();

    if (productIds.length > 0) {
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { model: true, serie: true },
      });
      products.forEach((p) => productMap.set(p.id, p));
    }

    if (tallaIds.length > 0) {
      const tallas = await this.prisma.tallaConfig.findMany({
        where: { id: { in: tallaIds } },
      });
      tallas.forEach((t) => tallaMap.set(t.id, t.numero));
    }

    // Resolver usuarios (vendedores de pedidos + cajeros de abonos + confirmadores de entrega + registradores de devoluciones)
    const pedidoUserIds = pedidos.map((p) => p.userId).filter(Boolean);
    const abonoUserIds = cobros.flatMap((c) =>
      c.abonos.map((a) => a.userId).filter(Boolean),
    );
    const dispatchUserIds = pedidos
      .map((p: any) => p.dispatchOrder?.confirmadoPorId)
      .filter(Boolean);
    const devUserIds = movsDevolucion.map((m: any) => m.userId).filter(Boolean);
    const histUserIds = [...new Set([...pedidoUserIds, ...abonoUserIds, ...dispatchUserIds, ...devUserIds])];
    const histUsers = histUserIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: histUserIds } },
          select: {
            id: true,
            nombre: true,
            email: true,
            rol: true,
            tenantId: true,
            tenant: { select: { id: true, name: true } },
          },
        })
      : [];
    const histUserMap = new Map(histUsers.map((u) => [u.id, u]));

    let defaultTenantUser: any = null;
    if (client.tenantId) {
      defaultTenantUser = await this.prisma.user.findFirst({
        where: { tenantId: client.tenantId },
        select: { id: true, nombre: true, email: true, rol: true },
      });
    }

    // Numeración correlativa cronológica
    const sortedPedidosCron = [...pedidos].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const orderNumberMap = new Map<string, string>();
    sortedPedidosCron.forEach((o, index) => {
      orderNumberMap.set(o.id, `PED-${String(index + 1).padStart(4, '0')}`);
    });

    // Consolidar timeline cronológico de movimientos
    const movimientos: any[] = [];

    // 1. Pedidos / Compras
    pedidos.forEach((p) => {
      const formattedLines = (p.lines || []).map((l) => {
        const prod = productMap.get(l.productId);
        const numeroTalla = tallaMap.get(l.tallaId);
        return {
          id: l.id,
          productId: l.productId,
          cantidad: l.cantidad,
          cantidadEntregada: l.cantidadEntregada || 0,
          precioUnitario: Number(l.precioUnitario || 0),
          subtotal: l.cantidad * Number(l.precioUnitario || 0),
          tipoVenta: l.tipoVenta,
          modelName: prod?.model?.name || 'Calzado',
          color: prod?.color || '',
          imageUrl: prod?.imageUrl || null,
          serieNombre: prod?.serie?.nombre || 'Estándar',
          code: prod?.code || '',
          baseCode: prod?.model?.baseCode || '',
          numeroTalla: numeroTalla ?? 0,
        };
      });

      const numCod = orderNumberMap.get(p.id) || `PED-${p.id.slice(0, 4).toUpperCase()}`;
      const vendedorPedido = histUserMap.get(p.userId);

      // Resolver quién confirmó la entrega (despacho)
      const dispatch = (p as any).dispatchOrder;
      const entregadorUser = dispatch?.confirmadoPorId
        ? histUserMap.get(dispatch.confirmadoPorId)
        : null;

      movimientos.push({
        id: `pedido-${p.id}`,
        pedidoId: p.id,
        tipo: 'COMPRA_PEDIDO',
        titulo: `#${numCod}`,
        numeroCodigo: numCod,
        descripcion: `Compra por canal ${p.canal} (${p.tipoPago}) - ${p.estado}`,
        monto: Number(p.montoTotal),
        estado: p.estado,
        fecha: p.createdAt,
        vendedorNombre: vendedorPedido?.nombre || '',
        vendedorEmail: vendedorPedido?.email || '',
        vendedorRol: vendedorPedido?.rol || '',
        entregadoPor: entregadorUser?.nombre || vendedorPedido?.nombre || '',
        entregadoPorEmail: entregadorUser?.email || '',
        entregadoPorRol: entregadorUser?.rol || '',
        fechaEntrega: dispatch?.confirmadoAt || null,
        detalles: {
          lineasCount: p.lines.length,
          lineas: formattedLines,
          notas: p.notas,
          canal: p.canal,
          tipoPago: p.tipoPago,
        },
      });
    });

    // 2. Abonos realizados — Consolidar en pagos únicos si pertenecen al mismo recibo o transacción
    const abonosAgrupadosMap = new Map<string, any>();

    cobros.forEach((c) => {
      c.abonos.forEach((a) => {
        const cajero = histUserMap.get(a.userId);
        const sucursalCajero = (cajero as any)?.tenant?.name || 'Administración Central';
        const esOtraSucursal = Boolean(cajero?.tenantId && c.tenantId && cajero.tenantId !== c.tenantId);

        // Detectar si el abono tiene tag de recibo [REC-XXXXXX]
        const matchRecibo = a.notas?.match(/\[(REC-[A-Z0-9]+)\]/i);
        const reciboTag = matchRecibo ? matchRecibo[1] : null;

        // Si tiene reciboTag se agrupa por ese identificador único. Si no, por fecha (mismo minuto) + usuario + método
        const keyGroup = reciboTag
          ? `recibo_${reciboTag}`
          : `abono_${a.userId}_${a.metodo}_${new Date(a.createdAt).toISOString().slice(0, 16)}`;

        if (abonosAgrupadosMap.has(keyGroup)) {
          const existing = abonosAgrupadosMap.get(keyGroup);
          existing.monto = Math.round((existing.monto + Number(a.monto)) * 100) / 100;
          if (c.saleNote?.numero) {
            existing.notasAfectadas.add(`#${String(c.saleNote.numero).padStart(4, '0')}`);
          }
        } else {
          const notasAfectadas = new Set<string>();
          if (c.saleNote?.numero) {
            notasAfectadas.add(`#${String(c.saleNote.numero).padStart(4, '0')}`);
          }
          const limpiaNota = a.notas ? a.notas.replace(/\[REC-[A-Z0-9]+\]/i, '').trim() : '';
          const esNotaGenerica = !limpiaNota || limpiaNota.toLowerCase() === 'abono unificado a cuenta';
          const comprobanteAbono = !esNotaGenerica ? limpiaNota : undefined;

          abonosAgrupadosMap.set(keyGroup, {
            id: `abono-grp-${a.id}`,
            tipo: 'ABONO',
            reciboRef: reciboTag,
            titulo: reciboTag ? `Abono a Cuenta (#${reciboTag})` : `Abono a Cobro #${c.saleNote?.numero || c.id.slice(0, 8).toUpperCase()}`,
            numeroCodigo: reciboTag || comprobanteAbono || undefined,
            monto: Number(a.monto),
            metodo: a.metodo,
            notas: a.notas,
            comprobante: comprobanteAbono,
            referencia: comprobanteAbono,
            numeroTransaccion: comprobanteAbono,
            fecha: a.createdAt,
            cobradoPor: cajero?.nombre || 'Usuario del sistema',
            cobradoPorEmail: cajero?.email || '',
            cobradoPorRol: cajero?.rol || '',
            cobradoPorSucursal: sucursalCajero,
            esCobroOtraSucursal: esOtraSucursal,
            notasAfectadas,
          });
        }
      });
    });

    abonosAgrupadosMap.forEach((abonoGrp) => {
      let desc = `Método: ${abonoGrp.metodo}`;
      if (abonoGrp.comprobante) {
        desc += ` • Trans/Comp: #${abonoGrp.comprobante.replace(/^#/, '')}`;
      } else if (abonoGrp.notas) {
        const limpiaNota = abonoGrp.notas.replace(/\[REC-[A-Z0-9]+\]/i, '').trim();
        if (limpiaNota && limpiaNota.toLowerCase() !== 'abono unificado a cuenta') desc += ` • ${limpiaNota}`;
      }
      if (abonoGrp.notasAfectadas.size > 0) {
        desc += ` (Aplicado a ${Array.from(abonoGrp.notasAfectadas).join(', ')})`;
      }
      movimientos.push({
        ...abonoGrp,
        descripcion: desc,
      });
    });

    // 3. Devoluciones de mercadería del cliente
    devolucionesCliente.forEach((d: any) => {
      const formattedDevLines = (d.lines || []).map((l: any) => {
        const prod = productMap.get(l.productId);
        const numeroTalla = tallaMap.get(l.tallaId);
        return {
          id: l.id,
          productId: l.productId,
          cantidad: l.cantidad,
          precioUnitario: Number(l.precioUnitario || 0),
          subtotal: Number(l.subtotal || l.cantidad * Number(l.precioUnitario || 0)),
          modelName: prod?.model?.name || 'Calzado',
          color: prod?.color || '',
          imageUrl: prod?.imageUrl || null,
          serieNombre: prod?.serie?.nombre || 'Estándar',
          numeroTalla: numeroTalla ?? 0,
        };
      });

      const totalPares = (d.lines || []).reduce((acc: number, l: any) => acc + l.cantidad, 0);

      // 1. Extraer tag [RECIBIDO POR: Nombre] si existe en d.motivo
      const matchRecibido = d.motivo?.match(/\[RECIBIDO POR:\s*([^\]]+)\]/i);
      let quienRecibio = matchRecibido ? matchRecibido[1].trim() : '';
      let quienRecibioRol = '';

      // 2. Si no tiene tag en motivo, correlacionar con MovimientoFinanciero por tiempo (registros históricos)
      if (!quienRecibio) {
        const dTime = new Date(d.createdAt).getTime();
        const movMatch = movsDevolucion.find((mf: any) => {
          const mfTime = new Date(mf.createdAt).getTime();
          return Math.abs(mfTime - dTime) <= 180000 && mf.userId;
        });
        if (movMatch && movMatch.userId) {
          const u = histUserMap.get(movMatch.userId);
          if (u) {
            quienRecibio = u.nombre || u.email;
            quienRecibioRol = u.rol || '';
          }
        }
      }

      // 3. Fallback a primer usuario activo o administrador de la sucursal
      if (!quienRecibio) {
        const fallbackUser = histUsers[0] || defaultTenantUser;
        if (fallbackUser) {
          quienRecibio = fallbackUser.nombre || fallbackUser.email;
          quienRecibioRol = fallbackUser.rol || 'Personal de Tienda';
        } else {
          quienRecibio = 'Administración / Recepción';
          quienRecibioRol = 'Personal de Tienda';
        }
      }

      // 4. Limpiar el motivo de tags para no ensuciar la descripción secundaria
      const motivoLimpio = (d.motivo || 'Devolución de mercadería')
        .replace(/\[RECIBIDO POR:\s*[^\]]+\]/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      movimientos.push({
        id: `devolucion-${d.id}`,
        tipo: 'DEVOLUCION',
        titulo: `Devolución de Calzado (${totalPares} pares)`,
        descripcion: motivoLimpio || 'Devolución de mercadería',
        monto: Number(d.deudaDescontada || d.totalDevuelto),
        totalDevuelto: Number(d.totalDevuelto),
        deudaDescontada: Number(d.deudaDescontada || 0),
        saldoAFavor: Number(d.saldoAFavor || 0),
        fecha: d.createdAt,
        procesadoPor: quienRecibio,
        procesadoPorRol: quienRecibioRol,
        detalles: {
          devolucionId: d.id,
          orderId: d.orderId,
          saleNoteId: d.saleNoteId,
          destinoStock: d.destinoStock,
          estado: d.estado,
          totalPares,
          lineas: formattedDevLines,
        },
      });
    });

    // 3.5. Incorporar deudas manuales o cobros directos no vinculados a pedidos
    const pedidoIdsSet = new Set(pedidos.map((p) => p.id));
    cobros.forEach((c) => {
      const vieneDePedido = c.saleNote?.orderId && pedidoIdsSet.has(c.saleNote.orderId);
      if (!vieneDePedido) {
        const esManual = c.saleNote?.orderId?.startsWith('MANUAL') || c.tipo === 'CREDITO';
        const numNota = c.saleNote?.numero
          ? `Nota #${String(c.saleNote.numero).padStart(4, '0')}`
          : `#${c.id.slice(0, 8).toUpperCase()}`;
        movimientos.push({
          id: `cobro-directo-${c.id}`,
          tipo: 'DEUDA_INICIAL',
          titulo: `Deuda / Saldo a Crédito (${numNota})`,
          numeroCodigo: numNota,
          descripcion: c.saleNote?.orderId?.startsWith('MANUAL')
            ? 'Registro de deuda anterior / Saldo migrado a cuenta corriente'
            : 'Venta a crédito directa en mostrador',
          monto: Number(c.montoTotal),
          estado: c.estado,
          fecha: c.createdAt,
          detalles: {
            tipoPago: 'CREDITO',
            notas: c.saleNote?.orderId,
          },
        });
      }
    });

    // Auto-sanitización de coherencia: cobros saldados, cancelados o de contado de este cliente nunca deben retener saldo pendiente
    try {
      await this.prisma.cobro.updateMany({
        where: {
          clientId,
          OR: [
            { estado: CobroEstado.SALDADO },
            { estado: 'CANCELADO' as any },
            { tipo: 'CONTADO' },
          ],
          saldoPendiente: { gt: 0 },
        },
        data: {
          saldoPendiente: 0,
        },
      });
    } catch (cleanClientCobrosErr) {
      // Continuar normalmente
    }

    const totalAbonado = cobros.reduce(
      (sum, c) => sum + c.abonos.reduce((s, a) => s + Number(a.monto), 0),
      0,
    );

    // Fuente única de verdad: Sólo los cobros con deuda pendiente real (no saldados ni de contado) constituyen saldo deudor
    const cobrosPendientesReales = cobros.filter((c) => {
      const esEstadoPendiente = c.estado === CobroEstado.PENDIENTE || c.estado === CobroEstado.PARCIALMENTE_PAGADO;
      const esCredito = (c.tipo as string) !== 'CONTADO';
      return esEstadoPendiente && esCredito && Number(c.saldoPendiente) > 0;
    });

    const saldoPendienteTotal = Math.max(
      0,
      cobrosPendientesReales.reduce((sum, c) => sum + Number(c.saldoPendiente), 0) - Number(client.saldoAFavor || 0),
    );

    // Auto-reconciliación estricta de creditoUtilizado en la base de datos
    if (Math.abs(Number(client.creditoUtilizado || 0) - saldoPendienteTotal) > 0.01) {
      await this.prisma.client.update({
        where: { id: clientId },
        data: { creditoUtilizado: saldoPendienteTotal },
      });
      client.creditoUtilizado = saldoPendienteTotal as any;
    }

    // 4. Corrida contable estricta: Ordenar cronológicamente (más antiguo primero) para calcular Saldo Anterior y Nuevo Saldo
    const movsCronologicos = [...movimientos].sort(
      (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
    );

    // Calcular delta acumulado de los movimientos conocidos
    let deltaNeto = 0;
    movsCronologicos.forEach((m) => {
      const monto = Number(m.monto || 0);
      if (m.tipo === 'COMPRA_PEDIDO' || m.tipo === 'DEUDA_INICIAL') {
        if (m.detalles?.tipoPago === 'CREDITO' || m.tipo === 'DEUDA_INICIAL') {
          deltaNeto += monto;
        }
      } else if (m.tipo === 'ABONO' || m.tipo === 'DEVOLUCION') {
        deltaNeto -= monto;
      }
    });

    // Calibración inicial para que la corrida contable coincida exactamente con el saldo deudor real
    let saldoCorriente = Math.max(0, Math.round((saldoPendienteTotal - deltaNeto) * 100) / 100);

    for (const m of movsCronologicos) {
      m.saldoAnterior = Math.round(saldoCorriente * 100) / 100;
      const monto = Number(m.monto || 0);
      if (m.tipo === 'COMPRA_PEDIDO' || m.tipo === 'DEUDA_INICIAL') {
        if (m.detalles?.tipoPago === 'CREDITO' || m.tipo === 'DEUDA_INICIAL') {
          saldoCorriente += monto;
        }
      } else if (m.tipo === 'ABONO') {
        saldoCorriente = Math.max(0, saldoCorriente - monto);
      } else if (m.tipo === 'DEVOLUCION') {
        saldoCorriente = Math.max(0, saldoCorriente - monto);
      }
      m.nuevoSaldo = Math.round(saldoCorriente * 100) / 100;
    }

    // Asegurar que el saldo del movimiento más reciente sea idéntico al saldo deudor pendiente
    if (movsCronologicos.length > 0) {
      movsCronologicos[movsCronologicos.length - 1].nuevoSaldo = saldoPendienteTotal;
    }

    // Invertir para mostrar el más reciente arriba en la vista del usuario
    movimientos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

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

    const client = await this.prisma.client.findUnique({
      where: { id: nota.clientId },
    });

    let clienteCedula = client?.cedula || '—';
    if (client?.cedula) {
      try {
        clienteCedula = this.encryptionService.decrypt(client.cedula);
      } catch {
        clienteCedula = client.cedula;
      }
    }

    let clienteRuc = client?.ruc || '';
    if (client?.ruc) {
      try {
        clienteRuc = this.encryptionService.decrypt(client.ruc);
      } catch {
        clienteRuc = client.ruc;
      }
    }

    return {
      ...nota,
      client: client
        ? {
            ...client,
            cedula: clienteCedula,
            ruc: clienteRuc,
          }
        : null,
    };
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

  // ── Registro Manual de Deuda Anterior / Saldo Inicial ───────
  async registrarDeudaManual(
    data: {
      clientId: string;
      monto: number;
      concepto: string;
      notas?: string;
      fechaVencimiento?: string | Date;
      fechaEmision?: string | Date;
      sucursalId?: string;
    },
    tenantId: string | null | undefined,
    userId: string,
  ) {
    const { clientId, monto, concepto, notas, fechaVencimiento, fechaEmision } = data;
    if (!clientId) throw new BadRequestException('Se requiere seleccionar el cliente.');
    const montoNum = Number(Number(monto || 0).toFixed(2));
    if (isNaN(montoNum) || montoNum <= 0) {
      throw new BadRequestException('El monto de la deuda debe ser un valor positivo mayor a 0.');
    }
    if (!concepto || !concepto.trim()) {
      throw new BadRequestException('Se requiere especificar el concepto o motivo de la deuda anterior.');
    }

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('El cliente especificado no existe.');

    // Resolver sucursal (tenantId): si es Admin General (tenantId es null),
    // usar el tenantId asignado al cliente o el sucursalId enviado en data, o la Matriz
    let effectiveTenantId = tenantId || (data as any).sucursalId || client.tenantId;
    if (!effectiveTenantId) {
      const matrizTenant = await this.prisma.tenant.findFirst({
        where: { active: true },
        orderBy: { createdAt: 'asc' },
      });
      effectiveTenantId = matrizTenant?.id || '';
    }
    if (!effectiveTenantId) {
      throw new BadRequestException('No se pudo determinar la sucursal para asociar la deuda del cliente.');
    }

    const lastNote = await this.prisma.saleNote.findFirst({
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    const numero = (lastNote?.numero || 0) + 1;
    const saleNoteId = crypto.randomUUID();
    const cobroId = crypto.randomUUID();
    const fechaCreacion = fechaEmision ? new Date(fechaEmision) : new Date();

    const saleNote = await this.prisma.saleNote.create({
      data: {
        id: saleNoteId,
        tenantId: effectiveTenantId,
        numero,
        orderId: `MANUAL-${Date.now()}`,
        clientId,
        subtotal: montoNum,
        descuento: 0,
        total: montoNum,
        pdfUrl: `/storage/notas-venta/nota-manual-${String(numero).padStart(6, '0')}.pdf`,
        createdAt: fechaCreacion,
        lines: {
          create: [
            {
              id: crypto.randomUUID(),
              productId: 'SALDO-ANTERIOR',
              nombre: concepto.trim(),
              serie: 'SALDO ANTERIOR',
              talla: '—',
              cantidad: 1,
              precioUnitario: montoNum,
              subtotal: montoNum,
            },
          ],
        },
      },
    });

    const vencimiento = fechaVencimiento
      ? new Date(fechaVencimiento)
      : new Date(Date.now() + 30 * 86400000);

    const cobro = await this.prisma.cobro.create({
      data: {
        id: cobroId,
        tenantId: effectiveTenantId,
        saleNoteId: saleNote.id,
        clientId,
        tipo: 'CREDITO',
        montoTotal: montoNum,
        saldoPendiente: montoNum,
        fechaVencimiento: vencimiento,
        estado: CobroEstado.PENDIENTE,
        createdAt: fechaCreacion,
      },
    });

    await this.prisma.client.update({
      where: { id: clientId },
      data: {
        creditoUtilizado: {
          increment: montoNum,
        },
      },
    });

    return {
      ok: true,
      message: 'Deuda anterior registrada exitosamente.',
      cobroId,
      saleNoteId,
      numeroNota: numero,
      monto: montoNum,
    };
  }

  // ── Registrar Abono Unificado por Cliente ─────────────────────────
  async registrarAbonoCliente(
    clientId: string,
    data: {
      monto: number;
      metodo: string;
      notas?: string;
      sucursalId?: string;
    },
    userId: string,
    tenantId?: string | null,
  ) {
    if (!clientId) throw new BadRequestException('Se requiere especificar el cliente para registrar el abono.');
    const montoTotal = Number(Number(data.monto || 0).toFixed(2));
    if (isNaN(montoTotal) || montoTotal <= 0) {
      throw new BadRequestException('El monto del abono debe ser un valor positivo mayor a 0.');
    }

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException(`Cliente con ID "${clientId}" no encontrado.`);

    // Auto-sanitización de coherencia previa al cálculo de abono
    try {
      await this.prisma.cobro.updateMany({
        where: {
          clientId,
          OR: [
            { estado: CobroEstado.SALDADO },
            { estado: 'CANCELADO' as any },
            { tipo: 'CONTADO' },
          ],
          saldoPendiente: { gt: 0 },
        },
        data: {
          saldoPendiente: 0,
        },
      });
    } catch (e) {
      // Continuar si la BD no permite update masivo
    }

    // 1. Obtener cobros pendientes a crédito ordenados por antigüedad (FIFO estricto)
    const cobrosPendientes = await this.prisma.cobro.findMany({
      where: {
        clientId,
        tipo: 'CREDITO',
        estado: { in: [CobroEstado.PENDIENTE, CobroEstado.PARCIALMENTE_PAGADO] },
        saldoPendiente: { gt: 0 },
      },
      include: { saleNote: true },
      orderBy: { createdAt: 'asc' },
    });

    const saldoAnterior = Math.max(
      0,
      cobrosPendientes.reduce((sum, c) => sum + Number(c.saldoPendiente), 0) - Number(client.saldoAFavor || 0),
    );

    const reciboRef = `REC-${Date.now().toString().slice(-6)}`;
    let restante = montoTotal;
    const cobrosAfectados: Array<{
      cobroId: string;
      numeroNota: number | string;
      montoAplicado: number;
      saldoAnteriorNota: number;
      nuevoSaldoNota: number;
    }> = [];

    // 2. Distribuir el abono en cascada FIFO
    for (const cobro of cobrosPendientes) {
      if (restante <= 0) break;
      const saldoNota = Number(cobro.saldoPendiente);
      const montoAplicar = Math.min(saldoNota, restante);
      const nuevoSaldoNota = Math.round((saldoNota - montoAplicar) * 100) / 100;
      const nuevoEstado = nuevoSaldoNota === 0 ? CobroEstado.SALDADO : CobroEstado.PARCIALMENTE_PAGADO;

      const abonoId = crypto.randomUUID();
      await this.prisma.cobroAbono.create({
        data: {
          id: abonoId,
          cobroId: cobro.id,
          monto: montoAplicar,
          metodo: data.metodo || 'EFECTIVO',
          notas: `[${reciboRef}] ${data.notas ? data.notas.trim() : 'Abono unificado a cuenta'}`,
          userId,
        },
      });

      await this.prisma.cobro.update({
        where: { id: cobro.id },
        data: {
          saldoPendiente: nuevoSaldoNota,
          estado: nuevoEstado,
        },
      });

      cobrosAfectados.push({
        cobroId: cobro.id,
        numeroNota: cobro.saleNote?.numero || cobro.id.slice(0, 8),
        montoAplicado: montoAplicar,
        saldoAnteriorNota: saldoNota,
        nuevoSaldoNota,
      });

      restante = Math.round((restante - montoAplicar) * 100) / 100;
    }

    // 3. Si sobró dinero (el cliente pagó más de lo adeudado), acreditar a saldoAFavor
    let nuevoSaldoAFavor = Number(client.saldoAFavor || 0);
    if (restante > 0) {
      nuevoSaldoAFavor = Math.round((nuevoSaldoAFavor + restante) * 100) / 100;
    }

    // 4. Recalcular deuda final y crédito utilizado de forma estricta (solo ventas a crédito pendientes)
    const cobrosRestantes = await this.prisma.cobro.findMany({
      where: {
        clientId,
        tipo: 'CREDITO',
        estado: { in: [CobroEstado.PENDIENTE, CobroEstado.PARCIALMENTE_PAGADO] },
        saldoPendiente: { gt: 0 },
      },
      select: { saldoPendiente: true },
    });
    const deudaFacturadaRestante = cobrosRestantes.reduce((sum, c) => sum + Number(c.saldoPendiente), 0);
    const nuevoCreditoUtilizado = Math.max(0, deudaFacturadaRestante - nuevoSaldoAFavor);

    await this.prisma.client.update({
      where: { id: clientId },
      data: {
        creditoUtilizado: nuevoCreditoUtilizado,
        saldoAFavor: nuevoSaldoAFavor,
      },
    });

    // 5. Emitir evento de abono registrado para notificaciones y trazabilidad
    try {
      if (this.eventEmitter) {
        this.eventEmitter.emit('AbonoRegistrado', {
          clientId,
          monto: montoTotal,
          saldoPendiente: nuevoCreditoUtilizado,
          metodo: data.metodo || 'EFECTIVO',
          reciboRef,
        });
      }
    } catch (e) {
      // Ignorar errores no críticos de eventos
    }

    return {
      ok: true,
      message: `Abono unificado de $${montoTotal.toFixed(2)} registrado exitosamente.`,
      reciboRef,
      montoTotal,
      saldoAnterior,
      nuevoSaldo: nuevoCreditoUtilizado,
      saldoAFavor: nuevoSaldoAFavor,
      cobrosAfectados,
      fecha: new Date(),
    };
  }

  // ── Cambiar Tipo de Venta / Cobro (Contado <-> Crédito) ───────────
  async cambiarTipoCobro(
    cobroId: string,
    body: {
      nuevoTipo: 'CREDITO' | 'CONTADO';
      diasPlazo?: number;
      fechaVencimiento?: string;
      notas?: string;
      montoAbonadoInicial?: number;
      metodoAbonoInicial?: string;
    },
    tenantId: string,
    userId: string,
  ) {
    const cobro = await this.prisma.cobro.findUnique({
      where: { id: cobroId },
      include: { abonos: true, saleNote: true },
    });

    if (!cobro) {
      throw new NotFoundException(`Cobro con ID "${cobroId}" no encontrado`);
    }

    const montoTotal = Number(cobro.montoTotal);

    if (body.nuevoTipo === 'CREDITO') {
      // Reemplazar abonos con el abono inicial real si aplica
      await this.prisma.cobroAbono.deleteMany({
        where: { cobroId },
      });

      let saldoPendiente = montoTotal;
      const abonoInicial = Number(body.montoAbonadoInicial || 0);

      if (abonoInicial > 0) {
        const abonoReal = Math.min(abonoInicial, montoTotal);
        await this.prisma.cobroAbono.create({
          data: {
            id: crypto.randomUUID(),
            cobroId,
            monto: abonoReal,
            metodo: body.metodoAbonoInicial || 'EFECTIVO',
            notas: body.notas ? `Anticipo/Abono inicial: ${body.notas}` : 'Anticipo/Abono inicial registrado',
            userId,
          },
        });
        saldoPendiente = Math.round((montoTotal - abonoReal) * 100) / 100;
      }

      // Calcular fecha de vencimiento
      const dias = Number(body.diasPlazo || 30);
      const fechaVencimiento = body.fechaVencimiento
        ? new Date(body.fechaVencimiento)
        : new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

      const nuevoEstado = saldoPendiente === 0
        ? CobroEstado.SALDADO
        : (saldoPendiente < montoTotal ? CobroEstado.PARCIALMENTE_PAGADO : CobroEstado.PENDIENTE);

      await this.prisma.cobro.update({
        where: { id: cobroId },
        data: {
          tipo: 'CREDITO',
          saldoPendiente,
          fechaVencimiento,
          estado: nuevoEstado,
        },
      });

      // Recalcular crédito utilizado del cliente
      if (cobro.clientId) {
        const todosCobrosPendientes = await this.prisma.cobro.findMany({
          where: { clientId: cobro.clientId, estado: { in: ['PENDIENTE', 'PARCIALMENTE_PAGADO'] } },
          select: { saldoPendiente: true },
        });
        const sumaDeuda = todosCobrosPendientes.reduce((acc, c) => acc + Number(c.saldoPendiente), 0);
        await this.prisma.client.update({
          where: { id: cobro.clientId },
          data: { creditoUtilizado: sumaDeuda },
        });
      }

      return {
        ok: true,
        message: 'Venta convertida a CRÉDITO exitosamente.',
        cobroId,
        saldoPendiente,
        fechaVencimiento,
      };
    } else {
      // Cambiar a CONTADO: Saldo pendiente = 0 y estado SALDADO
      const abonosActuales = await this.prisma.cobroAbono.findMany({ where: { cobroId } });
      const totalAbonado = abonosActuales.reduce((acc, a) => acc + Number(a.monto), 0);
      const faltante = Math.round((montoTotal - totalAbonado) * 100) / 100;

      if (faltante > 0) {
        await this.prisma.cobroAbono.create({
          data: {
            id: crypto.randomUUID(),
            cobroId,
            monto: faltante,
            metodo: body.metodoAbonoInicial || 'EFECTIVO',
            notas: body.notas || 'Cancelación total al cambiar a contado',
            userId,
          },
        });
      }

      await this.prisma.cobro.update({
        where: { id: cobroId },
        data: {
          tipo: 'CONTADO',
          saldoPendiente: 0,
          estado: CobroEstado.SALDADO,
        },
      });

      // Recalcular crédito utilizado del cliente
      if (cobro.clientId) {
        const todosCobrosPendientes = await this.prisma.cobro.findMany({
          where: { clientId: cobro.clientId, estado: { in: ['PENDIENTE', 'PARCIALMENTE_PAGADO'] } },
          select: { saldoPendiente: true },
        });
        const sumaDeuda = todosCobrosPendientes.reduce((acc, c) => acc + Number(c.saldoPendiente), 0);
        await this.prisma.client.update({
          where: { id: cobro.clientId },
          data: { creditoUtilizado: sumaDeuda },
        });
      }

      return {
        ok: true,
        message: 'Venta convertida a CONTADO y saldada exitosamente.',
        cobroId,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // GESTIÓN PERSISTENTE DE SALDO REAL EN CAJA / BANCOS (DB RAILWAY)
  // ══════════════════════════════════════════════════════════════

  async obtenerSaldoCaja(sucursalId?: string, tenantId?: string | null) {
    const targetKey = sucursalId && sucursalId !== 'TODAS' ? sucursalId : (tenantId || 'global');
    const token = `saldo_caja_${targetKey}`;
    const registro = await this.prisma.comprobantePublico.findUnique({
      where: { token },
    });

    let monto: number | null = null;
    let fechaActualizacion: string | null = null;
    if (registro?.payload && typeof registro.payload === 'object' && 'monto' in registro.payload) {
      monto = (registro.payload as any).monto !== null ? Number((registro.payload as any).monto) : null;
      fechaActualizacion = (registro.payload as any).updatedAt || registro.createdAt?.toISOString();
    }

    return {
      ok: true,
      sucursalId: targetKey,
      saldoPersonalizado: monto,
      updatedAt: fechaActualizacion,
    };
  }

  async guardarSaldoCaja(
    data: { monto: number | null; sucursalId?: string },
    tenantId?: string | null,
    userId?: string,
  ) {
    const targetKey = data.sucursalId && data.sucursalId !== 'TODAS' ? data.sucursalId : (tenantId || 'global');
    const token = `saldo_caja_${targetKey}`;

    if (data.monto === null || data.monto === undefined || data.monto === ('' as any)) {
      try {
        await this.prisma.comprobantePublico.delete({ where: { token } });
      } catch (e) {
        // Silencioso si no existía
      }
      return {
        ok: true,
        message: 'Saldo personalizado restablecido al cálculo automático en base de datos.',
        saldoPersonalizado: null,
      };
    }

    const valorNum = Math.round(Number(data.monto) * 100) / 100;
    if (isNaN(valorNum) || valorNum < 0) {
      throw new BadRequestException('El monto debe ser un valor numérico válido mayor o igual a 0.');
    }

    await this.prisma.comprobantePublico.upsert({
      where: { token },
      create: {
        token,
        tipo: 'CONFIG_SALDO_CAJA',
        payload: {
          monto: valorNum,
          sucursalId: targetKey,
          updatedAt: new Date().toISOString(),
          updatedBy: userId || 'admin',
        },
      },
      update: {
        payload: {
          monto: valorNum,
          sucursalId: targetKey,
          updatedAt: new Date().toISOString(),
          updatedBy: userId || 'admin',
        },
      },
    });

    return {
      ok: true,
      message: `Saldo real de $${valorNum.toFixed(2)} guardado exitosamente en base de datos.`,
      saldoPersonalizado: valorNum,
    };
  }
}

