import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';
import { NotificacionService } from '../NotificacionService';
import { cobroVencidoTemplate } from '../templates/cobro-vencido.template';
import { EstadoPedido, SupplierOrderStatus } from '@prisma/client';

export interface DatosBancariosDto {
  banco?: string;
  tipoCuenta?: string;
  numeroCuenta?: string;
  titular?: string;
  identificacion?: string;
}

export interface EnviarRecordatorioDto {
  cobroId: string;
  canal: 'WHATSAPP' | 'EMAIL';
  plantilla: 'PREVENTIVO' | 'FORMAL' | 'URGENTE';
  datosBancarios?: DatosBancariosDto;
  mensajePersonalizado?: string;
}

@Injectable()
export class NotificacionesQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly notificacionService: NotificacionService,
  ) {}

  /**
   * Resumen clasificado de alertas activas para el Centro de Notificaciones.
   */
  async obtenerResumen(tenantId?: string | null) {
    const ahora = new Date();

    // ── 1. Cobros en mora y por vencer ───────────────────────
    const cobrosPendientes = await this.prisma.cobro.findMany({
      where: {
        estado: { in: ['PENDIENTE', 'PARCIALMENTE_PAGADO'] },
        saldoPendiente: { gt: 0 },
        ...(tenantId ? { tenantId } : {}),
      },
      include: {
        saleNote: {
          select: {
            id: true,
            numero: true,
            total: true,
            orderId: true,
            createdAt: true,
          },
        },
        tenant: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { fechaVencimiento: 'asc' },
    });

    const clientIds = Array.from(new Set(cobrosPendientes.map((c) => c.clientId)));
    const clients = clientIds.length > 0
      ? await this.prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: {
            id: true,
            nombre: true,
            apellido: true,
            telefono: true,
            email: true,
            cedula: true,
            ruc: true,
          },
        })
      : [];

    const clientMap = new Map(
      clients.map((c) => [
        c.id,
        {
          ...c,
          cedulaDesencriptada: c.cedula ? this.safeDecrypt(c.cedula) : '',
          rucDesencriptado: c.ruc ? this.safeDecrypt(c.ruc) : '',
        },
      ]),
    );

    const cobrosDetallados = cobrosPendientes.map((cobro) => {
      const cliente = clientMap.get(cobro.clientId);
      const fechaVenc = cobro.fechaVencimiento || new Date(cobro.createdAt.getTime() + 15 * 24 * 60 * 60 * 1000);
      const diffMs = ahora.getTime() - new Date(fechaVenc).getTime();
      const diasVencido = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      let categoria: 'VENCIDO' | 'HOY' | 'POR_VENCER' | 'AL_DIA' = 'AL_DIA';
      let urgencia: 'CRITICA' | 'ALTA' | 'MEDIA' | 'PREVENTIVA' = 'PREVENTIVA';

      if (diasVencido > 0) {
        categoria = 'VENCIDO';
        if (diasVencido > 30) urgencia = 'CRITICA';
        else if (diasVencido > 15) urgencia = 'ALTA';
        else urgencia = 'MEDIA';
      } else if (diasVencido === 0) {
        categoria = 'HOY';
        urgencia = 'MEDIA';
      } else if (diasVencido >= -5) {
        categoria = 'POR_VENCER';
        urgencia = 'PREVENTIVA';
      }

      return {
        id: cobro.id,
        numeroNota: cobro.saleNote?.numero ? `NV-${String(cobro.saleNote.numero).padStart(6, '0')}` : 'S/N',
        clienteId: cobro.clientId,
        clienteNombre: cliente ? `${cliente.nombre} ${cliente.apellido || ''}`.trim() : 'Cliente no identificado',
        clienteTelefono: cliente?.telefono || '',
        clienteEmail: cliente?.email || '',
        clienteIdentificacion: cliente?.cedulaDesencriptada || cliente?.rucDesencriptado || '',
        montoTotal: Number(cobro.montoTotal),
        saldoPendiente: Number(cobro.saldoPendiente),
        fechaEmision: cobro.createdAt,
        fechaVencimiento: fechaVenc,
        diasVencido,
        categoria,
        urgencia,
        sucursalId: cobro.tenantId,
        sucursalNombre: cobro.tenant?.name || 'Matriz',
      };
    });

    const cobrosVencidos = cobrosDetallados.filter((c) => c.categoria === 'VENCIDO');
    const cobrosPorVencer = cobrosDetallados.filter((c) => c.categoria === 'POR_VENCER' || c.categoria === 'HOY');

    // ── 2. Alertas de Stock Crítico (< 12 pares o tallas en 0 en la serie) ──
    const products = await this.prisma.product.findMany({
      where: {
        active: true,
        ...(tenantId ? { model: { tenantId } } : {}),
      },
      include: {
        model: {
          select: {
            name: true,
            brand: true,
            tenantId: true,
            tenant: { select: { id: true, name: true } },
          },
        },
        stockByTalla: {
          include: {
            talla: true,
          },
        },
      },
    });

    const stockCritico = products
      .map((p) => {
        const totalPares = p.stockByTalla.reduce((acc: number, s) => acc + (s.quantity || 0), 0);
        const minRequerido = 12; // Menos de 1 docena completa (12 pares)
        const tallasAgotadas = p.stockByTalla
          .filter((s) => (s.quantity || 0) === 0)
          .map((s) => (s.talla?.numero !== undefined ? String(s.talla.numero) : s.tallaId))
          .filter(Boolean);

        let estadoStock: 'AGOTADO' | 'MENOS_DE_DOCENA' | 'SERIE_INCOMPLETA' | 'OPTIMO' = 'OPTIMO';
        let motivoAlerta = '';

        if (totalPares === 0) {
          estadoStock = 'AGOTADO';
          motivoAlerta = 'Sin existencias (0 pares en stock)';
        } else if (totalPares <= 11 && tallasAgotadas.length > 0) {
          estadoStock = 'MENOS_DE_DOCENA';
          motivoAlerta = `Menos de 1 docena (${totalPares} pares, 11 o menos) y faltan tallas: ${tallasAgotadas.join(', ')}`;
        } else if (totalPares <= 11) {
          estadoStock = 'MENOS_DE_DOCENA';
          motivoAlerta = `Menos de 1 docena en stock (${totalPares} pares disponibles, 11 o menos)`;
        } else if (tallasAgotadas.length > 0) {
          estadoStock = 'SERIE_INCOMPLETA';
          motivoAlerta = `Serie incompleta: sin stock en talla(s) ${tallasAgotadas.join(', ')}`;
        }

        return {
          id: p.id,
          nombre: `${p.model?.name || 'Calzado'} (${p.color})`,
          marca: p.model?.brand || 'NEXORA',
          modelo: p.code,
          sku: p.code,
          stockTotal: totalPares,
          stockMinimo: minRequerido,
          estadoStock,
          motivoAlerta,
          tallasAgotadas,
          sucursalNombre: p.model?.tenant?.name || 'Bodega Principal',
        };
      })
      .filter((p) => p.estadoStock !== 'OPTIMO');

    // ── 3. Órdenes de Pedido a Fabricantes / Talleres Pendientes de Pedir ─────────
    const ordenesProveedor = await this.prisma.supplierOrder.findMany({
      where: {
        estado: { in: [SupplierOrderStatus.PENDIENTE, SupplierOrderStatus.BORRADOR] },
        ...(tenantId ? { supplier: { tenantId } } : {}),
      },
      include: {
        supplier: {
          select: {
            id: true,
            razonSocial: true,
            contacto: true,
            email: true,
            tenantId: true,
            tenant: { select: { id: true, name: true } },
          },
        },
        lines: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    const allOrderProductIds = Array.from(
      new Set(ordenesProveedor.flatMap((o) => o.lines.map((l) => l.productId)).filter(Boolean)),
    );
    const orderProducts = allOrderProductIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: allOrderProductIds } },
          select: {
            id: true,
            code: true,
            color: true,
            imageUrl: true,
            serie: { select: { nombre: true } },
            model: { select: { name: true, brand: true } },
          },
        })
      : [];
    const orderProductMap = new Map(orderProducts.map((p) => [p.id, p]));

    const formatWhatsAppUrl = (phone: string, text: string) => {
      if (!phone) return '';
      let cleanPhone = phone.replace(/[\s\-\(\)\+]/g, '');
      if (cleanPhone.startsWith('09')) {
        cleanPhone = '593' + cleanPhone.substring(1);
      } else if (cleanPhone.startsWith('9')) {
        cleanPhone = '593' + cleanPhone;
      }
      return `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
    };

    const ordenesPorPedir = ordenesProveedor.map((o) => {
      const fechaCreacion = new Date(o.createdAt);
      const diasDesdeCreacion = Math.floor((ahora.getTime() - fechaCreacion.getTime()) / (1000 * 60 * 60 * 24));
      const esDemorada = diasDesdeCreacion > 5;
      const totalPares = o.lines.reduce((sum, l) => sum + (l.cantidadPedida || 0), 0);
      const provNombre = o.supplier?.razonSocial || 'Taller / Fabricante';
      const provTelefono = o.supplier?.contacto || '';

      // Agrupar líneas por producto/modelo
      const modelMap = new Map<string, any>();
      for (const l of o.lines) {
        const prod = orderProductMap.get(l.productId);
        const nombre = prod?.model?.name ? prod.model.name : `Modelo ${prod?.code || l.productId}`;
        if (!modelMap.has(l.productId)) {
          modelMap.set(l.productId, {
            productId: l.productId,
            nombre,
            marca: prod?.model?.brand || 'NEXORA',
            color: prod?.color || '',
            serieNombre: prod?.serie?.nombre || 'ADULTO',
            imageUrl: prod?.imageUrl || null,
            cantidadPedida: 0,
            precioCosto: Number(l.precioCosto),
            subtotal: 0,
            observacion: l.observacionLinea || '',
            tallas: [],
          });
        }
        const m = modelMap.get(l.productId);
        m.cantidadPedida += l.cantidadPedida;
        m.subtotal += Number(l.subtotal);
        m.tallas.push({
          numeroTalla: 38, // default si no está desglosado
          cantidad: l.cantidadPedida,
        });
      }

      const itemsDetalle = Array.from(modelMap.values());

      const lineasTexto = itemsDetalle
        .map((it) => `• ${it.nombre} (${it.color}) — ${it.cantidadPedida} pares ($${it.precioCosto.toFixed(2)} c/u)`)
        .join('\n');

      const mensajeWhatsApp = `👟 *ORDEN DE PEDIDO NEXORA — OC-${String(o.numero).padStart(5, '0')}*\n\nEstimado/a *${provNombre}*,\nLe saludamos de *NEXORA (Calzado 100% Cuero de Cevallos)*.\n\nLe compartimos el requerimiento de producción para el siguiente pedido:\n\n${lineasTexto}\n\n📦 *Total de Pares:* ${totalPares}\n💰 *Monto Estimado:* $${Number(o.total).toFixed(2)}\n${o.observaciones ? `📝 *Observaciones:* ${o.observaciones}\n` : ''}\nPor favor confirmar inicio de confección y fecha tentativa de entrega. ¡Muchas gracias!`;

      const whatsappUrl = formatWhatsAppUrl(provTelefono, mensajeWhatsApp);

      return {
        id: o.id,
        numero: `OC-${String(o.numero).padStart(5, '0')}`,
        numeroInt: o.numero,
        proveedorId: o.supplierId,
        proveedorNombre: provNombre,
        proveedorContacto: o.supplier?.contacto || '',
        proveedorTelefono: provTelefono,
        proveedorEmail: o.supplier?.email || '',
        total: Number(o.total),
        totalPares,
        status: o.estado,
        esBorrador: o.estado === SupplierOrderStatus.BORRADOR,
        observaciones: o.observaciones || '',
        fechaCreacion,
        diasTranscurridos: diasDesdeCreacion,
        esDemorada,
        items: itemsDetalle,
        whatsappUrl,
        sucursalNombre: o.supplier?.tenant?.name || 'Matriz',
      };
    });

    // ── 4. Mercadería por Devolver a Proveedores (Garantías & Falla de Fábrica) ──
    const devolucionesPendientes = await this.prisma.clienteDevolucion.findMany({
      where: {
        estado: 'PENDIENTE_DEVOLUCION_PROVEEDOR',
        ...(tenantId ? { tenantId } : {}),
      },
      include: {
        lines: true,
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    const devProductIds = Array.from(
      new Set(devolucionesPendientes.flatMap((d) => d.lines.map((l) => l.productId)).filter(Boolean)),
    );
    const devTallaIds = Array.from(
      new Set(devolucionesPendientes.flatMap((d) => d.lines.map((l) => l.tallaId)).filter(Boolean)),
    );

    const [devProducts, devTallas, devClients] = await Promise.all([
      devProductIds.length > 0
        ? this.prisma.product.findMany({
            where: { id: { in: devProductIds } },
            include: {
              serie: { select: { nombre: true } },
              model: {
                include: {
                  supplier: {
                    select: { id: true, razonSocial: true, contacto: true, email: true },
                  },
                },
              },
            },
          })
        : [],
      devTallaIds.length > 0
        ? this.prisma.tallaConfig.findMany({
            where: { id: { in: devTallaIds } },
          })
        : [],
      this.prisma.client.findMany({
        where: { id: { in: Array.from(new Set(devolucionesPendientes.map((d) => d.clientId))) } },
        select: { id: true, nombre: true, apellido: true, telefono: true },
      }),
    ]);

    const devProductMap = new Map(devProducts.map((p) => [p.id, p]));
    const devTallaMap = new Map(devTallas.map((t) => [t.id, t.numero]));
    const devClientMap = new Map(devClients.map((c) => [c.id, c]));

    const mercaderiaPorDevolver = devolucionesPendientes.map((d) => {
      const client = devClientMap.get(d.clientId);
      const fechaReg = new Date(d.createdAt);
      const diasPendiente = Math.floor((ahora.getTime() - fechaReg.getTime()) / (1000 * 60 * 60 * 24));
      let mainSupplier: any = null;

      // Agrupar las líneas de devolución por modelo para que todas las tallas queden en una sola tarjeta de modelo
      const modelMap = new Map<string, any>();
      for (const l of d.lines) {
        const prod = devProductMap.get(l.productId);
        const numTalla = devTallaMap.get(l.tallaId) ?? 38;
        if (prod?.model?.supplier && !mainSupplier) {
          mainSupplier = prod.model.supplier;
        }

        if (!modelMap.has(l.productId)) {
          modelMap.set(l.productId, {
            productId: l.productId,
            nombre: prod?.model?.name ? prod.model.name : 'Calzado con Falla',
            marca: prod?.model?.brand || 'NEXORA',
            color: prod?.color || '',
            serieNombre: prod?.serie?.nombre || 'ADULTO',
            imageUrl: prod?.imageUrl || null,
            precioUnitario: Number(l.precioUnitario),
            totalPares: 0,
            subtotal: 0,
            supplierId: prod?.model?.supplierId || null,
            supplierNombre: prod?.model?.supplier?.razonSocial || 'Taller Fabricante',
            supplierTelefono: prod?.model?.supplier?.contacto || '',
            tallas: [],
          });
        }

        const m = modelMap.get(l.productId);
        m.totalPares += l.cantidad;
        m.subtotal += Number(l.subtotal);
        m.tallas.push({
          tallaId: l.tallaId,
          numeroTalla: numTalla,
          cantidad: l.cantidad,
        });
      }

      // Ordenar tallas ascendentemente
      for (const m of modelMap.values()) {
        m.tallas.sort((a: any, b: any) => a.numeroTalla - b.numeroTalla);
      }

      const items = Array.from(modelMap.values());
      const totalPares = items.reduce((acc, it) => acc + it.totalPares, 0);
      const provNombre = mainSupplier?.razonSocial || items[0]?.supplierNombre || 'Taller Fabricante';
      const provTelefono = mainSupplier?.contacto || items[0]?.supplierTelefono || '';

      const lineasTexto = items
        .map((it) => {
          const tallasStr = it.tallas.map((t: any) => `T${t.numeroTalla}: ${t.cantidad}`).join(', ');
          return `• ${it.nombre} (${it.color}) [${tallasStr}] — ${it.totalPares} par(es)`;
        })
        .join('\n');

      const mensajeWhatsApp = `⚠️ *NOTIFICACIÓN DE MERCADERÍA POR DEVOLVER / GARANTÍA — NEXORA*\n\nEstimado/a *${provNombre}*,\nLe saludamos de *NEXORA Calzado*.\n\nLe informamos que disponemos de mercadería en custodia para devolución/cambio por garantía de fabricación:\n\n${lineasTexto}\n\n📦 *Total pares a devolver:* ${totalPares}\n📋 *Motivo / Falla:* ${d.motivo}\n💰 *Valor a liquidar / descontar:* $${Number(d.totalDevuelto).toFixed(2)}\n\nFavor coordinar la recepción o visita para el retiro correspondiente. ¡Muchas gracias!`;

      const whatsappUrl = formatWhatsAppUrl(provTelefono, mensajeWhatsApp);

      return {
        id: d.id,
        clienteDevolucionId: d.id,
        clienteNombre: client ? `${client.nombre} ${client.apellido || ''}`.trim() : 'Cliente NEXORA',
        clienteTelefono: client?.telefono || '',
        motivo: d.motivo,
        totalDevuelto: Number(d.totalDevuelto),
        deudaDescontada: Number(d.deudaDescontada),
        saldoAFavor: Number(d.saldoAFavor),
        totalPares,
        fecha: d.createdAt,
        diasPendiente,
        proveedorNombre: provNombre,
        proveedorTelefono: provTelefono,
        whatsappUrl,
        items,
        sucursalNombre: d.tenant?.name || 'Matriz',
      };
    });

    // ── 5. Envíos y Despachos en Tránsito ────────────────────
    const despachosEnTransito = await this.prisma.order.findMany({
      where: {
        estado: EstadoPedido.EN_TRANSITO,
        ...(tenantId ? { tenantId } : {}),
      },
      select: {
        id: true,
        clientId: true,
        tipoEntrega: true,
        courier: true,
        guiaEnvio: true,
        asumeFlete: true,
        costoEnvio: true,
        montoTotal: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    });

    const dispatchClientIds = Array.from(new Set(despachosEnTransito.map((d) => d.clientId)));
    const dispatchClients = dispatchClientIds.length > 0
      ? await this.prisma.client.findMany({
          where: { id: { in: dispatchClientIds } },
          select: { id: true, nombre: true, apellido: true, telefono: true },
        })
      : [];
    const dispatchClientMap = new Map(dispatchClients.map((c) => [c.id, c]));

    // ── 6. Alertas de Seguridad & GPS (Últimas 48 horas) ─────
    const hace48h = new Date(ahora.getTime() - 48 * 60 * 60 * 1000);
    const securityLogs = await this.prisma.auditLog.findMany({
      where: {
        createdAt: { gte: hace48h },
        ...(tenantId ? { tenantId } : {}),
        OR: [
          { entidad: { contains: 'GEOLOCALIZACION', mode: 'insensitive' } },
          { entidad: { contains: 'GPS', mode: 'insensitive' } },
          { accion: 'OPERACION_CRITICA' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const alertasSeguridad = securityLogs
      .map((log) => {
        const d: any = log.detalles || {};
        const body: any = d.body || {};
        const esDesactivacion = body.tipoEvento === 'GPS_DESACTIVADO_DURANTE_SESION' || log.accion === 'OPERACION_CRITICA';

        return {
          id: log.id,
          userEmail: log.userEmail || 'Usuario',
          userRol: log.userRol || 'Personal',
          tipoEvento: body.tipoEvento || 'ALERTA_SEGURIDAD',
          esCritica: esDesactivacion,
          titulo: esDesactivacion
            ? `⚠️ Desactivación de GPS: ${log.userEmail || 'Personal'}`
            : `📍 Evento de Ubicación: ${log.userEmail || 'Personal'}`,
          descripcion: body.observaciones || (esDesactivacion
            ? 'El usuario desactivó o bloqueó el permiso de ubicación en el navegador durante su sesión.'
            : 'Registro o reactivación de señal satelital GPS.'),
          fecha: log.createdAt,
        };
      })
      .filter((a) => a.esCritica);

    // ── 7. Métricas Agregadas ────────────────────────────────
    const saldoTotalVencido = cobrosVencidos.reduce((sum, c) => sum + c.saldoPendiente, 0);
    const saldoTotalPorVencer = cobrosPorVencer.reduce((sum, c) => sum + c.saldoPendiente, 0);
    const totalDemoradas = ordenesPorPedir.filter((o) => o.esDemorada).length;

    return {
      metricas: {
        totalAlertas:
          cobrosVencidos.length +
          cobrosPorVencer.length +
          stockCritico.length +
          ordenesPorPedir.length +
          mercaderiaPorDevolver.length +
          alertasSeguridad.length,
        totalCobrosVencidos: cobrosVencidos.length,
        totalCobrosPorVencer: cobrosPorVencer.length,
        totalStockCritico: stockCritico.length,
        totalOrdenesPorPedir: ordenesPorPedir.length,
        totalMercaderiaPorDevolver: mercaderiaPorDevolver.length,
        totalOrdenesDemoradas: totalDemoradas,
        totalEnviosEnTransito: despachosEnTransito.length,
        totalAlertasSeguridad: alertasSeguridad.length,
        saldoTotalVencido: Number(saldoTotalVencido.toFixed(2)),
        saldoTotalPorVencer: Number(saldoTotalPorVencer.toFixed(2)),
      },
      cobrosVencidos,
      cobrosPorVencer,
      stockCritico,
      ordenesPorPedir,
      ordenesProveedor: ordenesPorPedir, // Retrocompatibilidad
      mercaderiaPorDevolver,
      alertasSeguridad,
      enviosEnTransito: despachosEnTransito.map((d) => {
        const cl = dispatchClientMap.get(d.clientId);
        return {
          id: d.id,
          numeroPedido: `PED-${d.id.slice(0, 6).toUpperCase()}`,
          clienteNombre: cl ? `${cl.nombre} ${cl.apellido || ''}`.trim() : 'Cliente NEXORA',
          clienteTelefono: cl?.telefono || '',
          courier: d.courier || 'Transporte Los Andes',
          guia: d.guiaEnvio || 'Sin Guía',
          flete: d.asumeFlete === 'EMPRESA' ? `Asume Empresa ($${Number(d.costoEnvio || 0).toFixed(2)})` : 'Paga Cliente en Destino',
          total: Number(d.montoTotal),
          fechaEnvio: d.updatedAt,
        };
      }),
    };
  }

  /**
   * Historial de notificaciones despachadas.
   */
  async obtenerHistorial() {
    const logs = await (this.prisma as any).notificationLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 80,
    });

    return logs;
  }

  /**
   * Genera el contenido formal y envía o genera el link de cobro por WhatsApp/Email.
   */
  async enviarRecordatorioCobro(dto: EnviarRecordatorioDto, _userId?: string) {
    const cobro = await this.prisma.cobro.findUnique({
      where: { id: dto.cobroId },
      include: {
        saleNote: true,
        tenant: { select: { id: true, name: true } },
      },
    });

    if (!cobro) {
      throw new NotFoundException(`El cobro ${dto.cobroId} no existe`);
    }

    const client = await this.prisma.client.findUnique({
      where: { id: cobro.clientId },
    });

    const clienteNombre = client ? `${client.nombre} ${client.apellido || ''}`.trim() : 'Estimado/a Cliente';
    const telefono = client?.telefono || '';
    const email = client?.email || '';
    const saldo = Number(cobro.saldoPendiente).toFixed(2);
    const notaNumero = cobro.saleNote?.numero ? String(cobro.saleNote.numero).padStart(6, '0') : 'S/N';
    
    const fechaVenc = cobro.fechaVencimiento || new Date(cobro.createdAt.getTime() + 15 * 24 * 60 * 60 * 1000);
    const fechaVencStr = new Date(fechaVenc).toLocaleDateString('es-EC', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    const ahora = new Date();
    const diffMs = ahora.getTime() - new Date(fechaVenc).getTime();
    const diasVencido = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    // Construcción de bloque bancario si fue provisto
    let bloqueBancario = '';
    if (dto.datosBancarios?.banco && dto.datosBancarios?.numeroCuenta) {
      bloqueBancario = `\n🏦 *Cuentas Bancarias para Transferencia/Depósito:*\n• *Banco:* ${dto.datosBancarios.banco}\n• *Tipo de Cuenta:* ${dto.datosBancarios.tipoCuenta || 'Ahorros'}\n• *Nro. de Cuenta:* ${dto.datosBancarios.numeroCuenta}\n• *Titular:* ${dto.datosBancarios.titular || 'NEXORA CALZADO'}\n• *RUC/Cédula:* ${dto.datosBancarios.identificacion || '1801234567001'}\n`;
    }

    // Generar texto según plantilla
    let mensaje = '';
    let asunto = '';

    if (dto.mensajePersonalizado && dto.mensajePersonalizado.trim().length > 0) {
      mensaje = dto.mensajePersonalizado.trim();
      asunto = `NEXORA — Notificación de Pago de Calzado`;
    } else if (dto.plantilla === 'PREVENTIVO') {
      asunto = `NEXORA — 👞 Recordatorio Preventivo de Cobro`;
      mensaje = `👟 *RECORDATORIO DE PAGO — NEXORA*\n\nEstimado/a *${clienteNombre}*,\n\nLe saludamos cordialmente de *NEXORA (Calzado 100% Cuero de Cevallos)*.\n\nLe recordamos amablemente que su compra a crédito correspondiente a la Nota de Venta *#${notaNumero}* por un saldo de *$${saldo}* tiene fecha programada de vencimiento para el *${fechaVencStr}*.\n${bloqueBancario}\nAgradecemos de antemano su confianza y puntualidad en sus pagos, lo que le permite mantener su cupo mayorista siempre activo.\n\n¡Que tenga un excelente día! ✨`;
    } else if (dto.plantilla === 'FORMAL') {
      asunto = `NEXORA — ⚠️ Aviso de Cobro Vencido - NV #${notaNumero}`;
      mensaje = `⚠️ *ESTADO DE CUENTA — AVISO DE COBRO NEXORA*\n\nEstimado/a *${clienteNombre}*,\n\nNos comunicamos de *NEXORA* para informarle que su crédito asociado a la Nota de Venta *#${notaNumero}* presenta un saldo pendiente de *$${saldo}* con *${diasVencido > 0 ? diasVencido : '1'} días de vencimiento* (Fecha límite: ${fechaVencStr}).\n\nLe invitamos a realizar su abono o cancelación para mantener su calificación crediticia en regla y continuar accediendo a promociones y lotes de calzado al por mayor.\n${bloqueBancario}\nSi ya realizó su depósito o transferencia, por favor envíenos su comprobante por este medio para registrarlo de inmediato.\n\nAtentamente,\n*Departamento de Cartera — NEXORA*`;
    } else {
      // URGENTE
      asunto = `NEXORA — 🚨 NOTIFICACIÓN DE COBRO URGENTE - NV #${notaNumero}`;
      mensaje = `🚨 *NOTIFICACIÓN DE COBRO URGENTE — NEXORA*\n\nEstimado/a *${clienteNombre}*,\n\nRegistramos un atraso prolongado de *${diasVencido > 0 ? diasVencido : 'más de 15'} días* en el pago de su cuenta pendiente por el valor de *$${saldo}* correspondiente a la Nota de Venta *#${notaNumero}*.\n\nLe solicitamos comunicarse de manera prioritaria el día de hoy para coordinar la cancelación de su saldo y evitar la suspensión definitiva de sus líneas de crédito comercial y el pase de su cuenta a gestión legal.\n${bloqueBancario}\nEsperamos su pronta confirmación de pago el día de hoy.\n\n*Área Legal y Cobranzas — NEXORA*`;
    }

    // Limpieza de teléfono ecuatoriano para enlace de WhatsApp (+593)
    let cleanPhone = telefono.replace(/[\s\-\(\)\+]/g, '');
    if (cleanPhone.startsWith('09')) {
      cleanPhone = '593' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('9')) {
      cleanPhone = '593' + cleanPhone;
    }

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(mensaje)}`;

    // Si el canal es EMAIL y el cliente tiene email registrado, despachar por NotificacionService
    if (dto.canal === 'EMAIL' && email) {
      const htmlBody = cobroVencidoTemplate({
        clienteNombre,
        cobroId: notaNumero,
        saldoPendiente: Number(cobro.saldoPendiente),
        diasVencido,
      });

      await this.notificacionService.enviar({
        canal: 'EMAIL',
        destinatario: email,
        asunto,
        cuerpoHtml: htmlBody,
        eventoOrigen: `RecordatorioCobro_${dto.plantilla}`,
      });
    } else {
      // Registrar log de notificación por WhatsApp
      await (this.prisma as any).notificationLog.create({
        data: {
          canal: 'WHATSAPP',
          destinatario: cleanPhone || clienteNombre,
          asunto: `Recordatorio ${dto.plantilla} - NV #${notaNumero} ($${saldo})`,
          eventoOrigen: `RecordatorioCobro_${dto.plantilla}`,
          estado: 'ENVIADO',
        },
      }).catch(() => {});
    }

    return {
      ok: true,
      mensaje,
      whatsappUrl,
      destinatario: cleanPhone || email || clienteNombre,
      canal: dto.canal,
      clienteNombre,
      saldo,
      notaNumero,
    };
  }

  /**
   * Envía un comprobante oficial de transacción (abono, cobro, pedido, entrega, devolución) por correo electrónico.
   */
  async enviarEmailComprobante(params: {
    destinatario: string;
    asunto: string;
    tipo: 'ABONO' | 'PEDIDO' | 'ENTREGA' | 'DEVOLUCION' | 'COMPRA' | 'GENERAL';
    cuerpoHtml?: string;
    detalles?: any;
  }) {
    const { destinatario, asunto, tipo, cuerpoHtml, detalles } = params;

    let finalHtml = cuerpoHtml;
    if (!finalHtml) {
      finalHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; background: #07080a; color: #eef2f7; border-radius: 20px; padding: 32px 24px; border: 1px solid rgba(255,255,255,0.08);">
          <div style="text-align: center; margin-bottom: 24px;">
            <span style="display: inline-block; padding: 5px 12px; background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.25); border-radius: 99px; font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">
              NEXORA CALZADO
            </span>
            <h1 style="color: #ffffff; font-size: 20px; font-weight: 800; margin: 14px 0 4px;">
              ${asunto}
            </h1>
            <p style="color: rgba(238,242,247,0.6); font-size: 13px; margin: 0;">
              Comprobante de operación comercial
            </p>
          </div>

          <div style="background: #14161a; border-radius: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.06); margin-bottom: 20px;">
            ${detalles?.mensaje ? `<p style="font-size: 13px; line-height: 1.6; color: #cbd5e1; white-space: pre-line; margin: 0;">${detalles.mensaje}</p>` : `<p style="font-size: 13px; color: #cbd5e1;">Estimado/a cliente, adjuntamos la información de su transacción realizada en NEXORA.</p>`}
          </div>

          <p style="text-align: center; font-size: 11px; color: rgba(238,242,247,0.4); margin: 20px 0 0;">
            Gracias por confiar en NEXORA · Sistema de Gestión Comercial
          </p>
        </div>
      `;
    }

    try {
      await this.notificacionService.enviar({
        canal: 'EMAIL',
        destinatario,
        asunto,
        cuerpoHtml: finalHtml,
        eventoOrigen: `Comprobante_${tipo}`,
      });

      return {
        ok: true,
        destinatario,
        tipo,
        asunto,
      };
    } catch (err: any) {
      return {
        ok: false,
        destinatario,
        tipo,
        asunto,
        error: err?.message || 'Error al enviar correo',
      };
    }
  }

  private safeDecrypt(encryptedText?: string | null): string {
    if (!encryptedText) return '';
    try {
      return this.encryptionService.decrypt(encryptedText);
    } catch {
      return encryptedText;
    }
  }
}
