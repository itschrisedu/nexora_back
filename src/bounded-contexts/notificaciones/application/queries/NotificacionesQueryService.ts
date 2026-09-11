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

    // ── 2. Alertas de Stock Crítico ─────────────────────────
    const products = await this.prisma.product.findMany({
      where: {
        active: true,
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

    const filteredProducts = tenantId
      ? products.filter((p) => p.model?.tenantId === tenantId)
      : products;

    const stockCritico = filteredProducts
      .map((p) => {
        const totalPares = p.stockByTalla.reduce((acc: number, s) => acc + (s.quantity || 0), 0);
        const minRequerido = 15;
        const tallasAgotadas = p.stockByTalla.filter((s) => (s.quantity || 0) === 0).map((s) => s.talla?.numero);

        return {
          id: p.id,
          nombre: `${p.model?.name || 'Calzado'} (${p.color})`,
          marca: p.model?.brand || 'NEXORA',
          modelo: p.code,
          sku: p.code,
          stockTotal: totalPares,
          stockMinimo: minRequerido,
          estadoStock: totalPares === 0 ? 'AGOTADO' : totalPares <= minRequerido ? 'BAJO' : 'OPTIMO',
          tallasAgotadas,
          sucursalNombre: p.model?.tenant?.name || 'Bodega Principal',
        };
      })
      .filter((p) => p.estadoStock !== 'OPTIMO');

    // ── 3. Órdenes a Proveedores / Talleres Demoradas ─────────
    const ordenesProveedor = await this.prisma.supplierOrder.findMany({
      where: {
        estado: { in: [SupplierOrderStatus.PENDIENTE, SupplierOrderStatus.BORRADOR] },
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
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const filteredOrdenes = tenantId
      ? ordenesProveedor.filter((o) => o.supplier?.tenantId === tenantId)
      : ordenesProveedor;

    const ordenesDemoradas = filteredOrdenes.map((o) => {
      const fechaCreacion = new Date(o.createdAt);
      const diasDesdeCreacion = Math.floor((ahora.getTime() - fechaCreacion.getTime()) / (1000 * 60 * 60 * 24));
      const esDemorada = diasDesdeCreacion > 5;

      return {
        id: o.id,
        numero: `OC-${String(o.numero).padStart(5, '0')}`,
        proveedorNombre: o.supplier?.razonSocial || 'Taller / Fabricante',
        proveedorContacto: o.supplier?.contacto || '',
        total: Number(o.total),
        status: o.estado,
        fechaCreacion,
        diasTranscurridos: diasDesdeCreacion,
        esDemorada,
        sucursalNombre: o.supplier?.tenant?.name || 'Matriz',
      };
    });

    // ── 4. Envíos y Despachos en Tránsito ────────────────────
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

    // ── 5. Métricas Agregadas ────────────────────────────────
    const saldoTotalVencido = cobrosVencidos.reduce((sum, c) => sum + c.saldoPendiente, 0);
    const saldoTotalPorVencer = cobrosPorVencer.reduce((sum, c) => sum + c.saldoPendiente, 0);

    return {
      metricas: {
        totalAlertas: cobrosVencidos.length + cobrosPorVencer.length + stockCritico.length + ordenesDemoradas.filter(o => o.esDemorada).length,
        totalCobrosVencidos: cobrosVencidos.length,
        totalCobrosPorVencer: cobrosPorVencer.length,
        totalStockCritico: stockCritico.length,
        totalOrdenesDemoradas: ordenesDemoradas.filter(o => o.esDemorada).length,
        totalEnviosEnTransito: despachosEnTransito.length,
        saldoTotalVencido: Number(saldoTotalVencido.toFixed(2)),
        saldoTotalPorVencer: Number(saldoTotalPorVencer.toFixed(2)),
      },
      cobrosVencidos,
      cobrosPorVencer,
      stockCritico,
      ordenesProveedor: ordenesDemoradas,
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

  private safeDecrypt(encryptedText?: string | null): string {
    if (!encryptedText) return '';
    try {
      return this.encryptionService.decrypt(encryptedText);
    } catch {
      return encryptedText;
    }
  }
}
