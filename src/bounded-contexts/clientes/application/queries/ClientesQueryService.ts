import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

@Injectable()
export class ClientesQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async obtenerCliente(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!client) {
      throw new NotFoundException(`Cliente con ID "${id}" no encontrado`);
    }

    return this.formatCliente(client);
  }

  async buscarClientes(
    filtros: { q?: string; nivelCredito?: PrismaNivelCredito; activo?: boolean },
    tenantId?: string | null,
  ) {
    const where: any = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (filtros.q) {
      where.OR = [
        { nombre: { contains: filtros.q, mode: 'insensitive' } },
        { apellido: { contains: filtros.q, mode: 'insensitive' } },
        { telefono: { contains: filtros.q, mode: 'insensitive' } },
      ];
    }

    if (filtros.nivelCredito) {
      where.nivelCredito = filtros.nivelCredito;
    }

    if (filtros.activo !== undefined) {
      where.activo = filtros.activo;
    }

    const clients = await this.prisma.client.findMany({
      where,
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });

    return clients.map((c) => this.formatCliente(c));
  }

  async obtenerHistorialCambiosNivel(clienteId: string) {
    const history = await this.prisma.creditScoreHistory.findMany({
      where: { clientId: clienteId },
      orderBy: { createdAt: 'desc' },
    });

    return history;
  }

  async validarCapacidadCrediticia(clienteId: string, montoSolicitado: number) {
    const client = await this.prisma.client.findUnique({
      where: { id: clienteId },
    });

    if (!client) {
      throw new NotFoundException(`Cliente con ID "${clienteId}" no encontrado`);
    }

    const limiteTotal = Number(client.limiteCredito);
    const creditoUtilizado = Number(client.creditoUtilizado);
    const limiteDisponible = Math.max(0, limiteTotal - creditoUtilizado);

    // Obtener configuración del nivel del cliente
    const configNivel = await this.prisma.creditLevelConfig.findUnique({
      where: { nivel: client.nivelCredito },
    });

    const plazoDias = configNivel ? configNivel.plazoDias : 0;

    // Lógica de rechazos
    if (client.nivelCredito === PrismaNivelCredito.SIN_CREDITO || limiteTotal <= 0) {
      return {
        aprobado: false,
        nivelActual: client.nivelCredito,
        limiteTotal,
        creditoUtilizado,
        limiteDisponible,
        plazoDias,
        razon: 'El cliente está en Nivel 1 (Sin Crédito). Requiere compras de contado o asignación de nivel por el Administrador.',
      };
    }

    if (montoSolicitado > limiteDisponible) {
      return {
        aprobado: false,
        nivelActual: client.nivelCredito,
        limiteTotal,
        creditoUtilizado,
        limiteDisponible,
        plazoDias,
        razon: `Monto supera límite disponible ($${limiteDisponible.toFixed(2)})`,
      };
    }

    return {
      aprobado: true,
      nivelActual: client.nivelCredito,
      limiteTotal,
      creditoUtilizado,
      limiteDisponible,
      plazoDias,
    };
  }

  // ── Mapeador interno para descifrado ─────────

  private formatCliente(record: any) {
    let rucDescifrado: string | null = null;
    let cedulaDescifrada: string | null = null;

    try {
      if (record.ruc) {
        rucDescifrado = this.encryptionService.decrypt(record.ruc);
      }
    } catch (e) {
      rucDescifrado = record.ruc;
    }

    try {
      if (record.cedula) {
        cedulaDescifrada = this.encryptionService.decrypt(record.cedula);
      }
    } catch (e) {
      cedulaDescifrada = record.cedula;
    }

    return {
      id: record.id,
      nombre: record.nombre,
      apellido: record.apellido,
      telefono: record.telefono,
      email: record.email,
      ruc: rucDescifrado,
      cedula: cedulaDescifrada,
      direccion: record.direccion,
      notas: record.notas,
      nivelCredito: record.nivelCredito,
      totalCompras: record.totalCompras,
      comprasSinAtraso: record.comprasSinAtraso,
      atrasoConsecutivo: record.atrasoConsecutivo,
      limiteCredito: Number(record.limiteCredito),
      creditoUtilizado: Number(record.creditoUtilizado),
      creditoDisponible: Math.max(0, Number(record.limiteCredito) - Number(record.creditoUtilizado)),
      activo: record.activo,
      tenantId: record.tenantId,
      sucursalNombre: record.tenant?.name || '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  // ══════════════════════════════
  // CRM & FIDELIZACIÓN: CLIENTES INACTIVOS (> 30 DÍAS)
  // ══════════════════════════════

  async obtenerClientesInactivos(tenantId: string, diasMinimos = 30) {
    const clients = await this.prisma.client.findMany({
      where: {
        tenantId,
        activo: true,
      },
      include: { tenant: { select: { id: true, name: true } } },
    });

    const now = new Date();
    const inactivos: any[] = [];

    for (const c of clients) {
      // Buscar la última orden y la última nota de venta
      const ultimaOrden = await this.prisma.order.findFirst({
        where: { tenantId, clientId: c.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, montoTotal: true, estado: true },
      });

      const ultimaNota = await this.prisma.saleNote.findFirst({
        where: { tenantId, clientId: c.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, total: true, numero: true },
      });

      let ultimaFecha: Date | null = null;
      let ultimoMonto = 0;

      if (ultimaOrden && ultimaNota) {
        if (new Date(ultimaOrden.createdAt) >= new Date(ultimaNota.createdAt)) {
          ultimaFecha = new Date(ultimaOrden.createdAt);
          ultimoMonto = Number(ultimaOrden.montoTotal || 0);
        } else {
          ultimaFecha = new Date(ultimaNota.createdAt);
          ultimoMonto = Number(ultimaNota.total || 0);
        }
      } else if (ultimaOrden) {
        ultimaFecha = new Date(ultimaOrden.createdAt);
        ultimoMonto = Number(ultimaOrden.montoTotal || 0);
      } else if (ultimaNota) {
        ultimaFecha = new Date(ultimaNota.createdAt);
        ultimoMonto = Number(ultimaNota.total || 0);
      } else {
        // Nunca ha comprado: usar fecha de registro
        ultimaFecha = new Date(c.createdAt);
        ultimoMonto = 0;
      }

      const diffMs = now.getTime() - ultimaFecha.getTime();
      const diasSinComprar = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diasSinComprar >= diasMinimos) {
        let rango = '30_A_60_DIAS';
        if (diasSinComprar > 90) rango = 'MAS_DE_90_DIAS';
        else if (diasSinComprar > 60) rango = '60_A_90_DIAS';

        const formatted = this.formatCliente(c);

        inactivos.push({
          ...formatted,
          diasSinComprar,
          ultimaCompraFecha: ultimaFecha.toISOString(),
          ultimoMonto,
          nuncaCompro: !ultimaOrden && !ultimaNota,
          rangoInactividad: rango,
        });
      }
    }

    // Ordenar de mayor a menor días de inactividad
    return inactivos.sort((a, b) => b.diasSinComprar - a.diasSinComprar);
  }

  // ══════════════════════════════
  // CRM & CAMPAÑAS PROMOCIONALES / CUPONES
  // ══════════════════════════════

  async obtenerPromociones(tenantId: string) {
    if (!tenantId) return [];
    return this.prisma.campanaPromocion.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async crearPromocion(tenantId: string, dto: any) {
    const codigoClean = (dto.codigo || '').toUpperCase().trim();
    if (!codigoClean) {
      throw new NotFoundException('El código del cupón o promoción es obligatorio.');
    }

    const existe = await this.prisma.campanaPromocion.findUnique({
      where: {
        tenantId_codigo: {
          tenantId,
          codigo: codigoClean,
        },
      },
    });

    if (existe) {
      throw new NotFoundException(`El código "${codigoClean}" ya existe para este negocio.`);
    }

    return this.prisma.campanaPromocion.create({
      data: {
        tenantId,
        codigo: codigoClean,
        titulo: dto.titulo?.trim() || `Promoción ${codigoClean}`,
        descripcion: dto.descripcion?.trim() || null,
        tipoDescuento: dto.tipoDescuento || 'PORCENTAJE',
        valorDescuento: Number(dto.valorDescuento) || 10,
        minimoPares: Number(dto.minimoPares) || 1,
        maximoCanjes: Number(dto.maximoCanjes) || 10, // ej. primeras 10 personas
        canjesUsados: 0,
        aplicaPara: (dto.aplicaPara as any) || 'AMBAS',
        fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : null,
        activo: true,
        mensajePlantilla: dto.mensajePlantilla?.trim() || null,
      },
    });
  }

  async validarCupon(
    tenantId: string,
    codigo: string,
    totalPares = 1,
    totalMonto = 0,
    tipoPago?: 'CONTADO' | 'CREDITO',
  ) {
    const codigoClean = (codigo || '').toUpperCase().trim();
    const promo = await this.prisma.campanaPromocion.findUnique({
      where: {
        tenantId_codigo: {
          tenantId,
          codigo: codigoClean,
        },
      },
    });

    if (!promo || !promo.activo) {
      return { valido: false, mensaje: 'El cupón no existe o está inactivo.' };
    }

    if (promo.fechaFin && new Date() > new Date(promo.fechaFin)) {
      return { valido: false, mensaje: 'El cupón ha expirado.' };
    }

    if (promo.canjesUsados >= promo.maximoCanjes) {
      return {
        valido: false,
        mensaje: `Este cupón ya alcanzó el límite de personas permitido (${promo.maximoCanjes} canjes).`,
      };
    }

    if (totalPares < promo.minimoPares) {
      return {
        valido: false,
        mensaje: `Este cupón requiere un mínimo de ${promo.minimoPares} pares de calzado.`,
      };
    }

    if (tipoPago) {
      if (promo.aplicaPara === 'SOLO_CONTADO' && tipoPago === 'CREDITO') {
        return {
          valido: false,
          mensaje: 'Este cupón es exclusivo para pagos de Contado.',
        };
      }
      if (promo.aplicaPara === 'SOLO_CREDITO' && tipoPago === 'CONTADO') {
        return {
          valido: false,
          mensaje: 'Este cupón es exclusivo para compras a Crédito.',
        };
      }
    }

    let montoDescuento = 0;
    const valor = Number(promo.valorDescuento);

    if (promo.tipoDescuento === 'PORCENTAJE') {
      montoDescuento = (totalMonto * valor) / 100;
    } else if (promo.tipoDescuento === 'MONTO_FIJO') {
      montoDescuento = Math.min(totalMonto, valor);
    } else if (promo.tipoDescuento === 'DESCUENTO_POR_PAR') {
      montoDescuento = valor * totalPares;
    }

    return {
      valido: true,
      promocion: promo,
      cuposRestantes: promo.maximoCanjes - promo.canjesUsados,
      descuentoCalculado: Number(montoDescuento.toFixed(2)),
      mensaje: `¡Cupón válido! Descuento de $${montoDescuento.toFixed(2)} (${promo.maximoCanjes - promo.canjesUsados} cupos restantes).`,
    };
  }

  async registrarCanjeCupon(tenantId: string, codigo: string) {
    const codigoClean = (codigo || '').toUpperCase().trim();
    const promo = await this.prisma.campanaPromocion.findUnique({
      where: {
        tenantId_codigo: {
          tenantId,
          codigo: codigoClean,
        },
      },
    });

    if (promo && promo.canjesUsados < promo.maximoCanjes) {
      await this.prisma.campanaPromocion.update({
        where: { id: promo.id },
        data: {
          canjesUsados: promo.canjesUsados + 1,
        },
      });
    }
  }

  async eliminarPromocion(id: string, tenantId: string) {
    return this.prisma.campanaPromocion.delete({
      where: { id, tenantId },
    });
  }
}

