import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../shared/infrastructure/encryption/encryption.service';
import { CanalEntrada, EstadoPedido, TipoPago, TipoVenta, MovimientoTipo, TipoCobro, CobroEstado } from '@prisma/client';

export interface AbrirCajaDto {
  montoInicial: number;
  notas?: string;
}

export interface RegistrarVentaPosDto {
  clienteId?: string;
  tipoComprobante?: 'CONSUMIDOR_FINAL' | 'FACTURA';
  clienteData?: {
    cedula?: string;
    ruc?: string;
    nombre: string;
    apellido?: string;
    email?: string;
    telefono?: string;
    direccion?: string;
  };
  metodoPago: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';
  lineas: {
    productId: string;
    serieId: string;
    tallaId: string;
    cantidad: number;
    precioUnitario: number;
  }[];
  notas?: string;
}

export interface CerrarCajaDto {
  montoRealEfectivo: number;
  notas?: string;
}

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Resuelve el tenantId activo
   */
  private async resolveTenantId(tenantId?: string | null): Promise<string> {
    if (tenantId) {
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (t) return t.id;
    }
    const firstTenant = await this.prisma.tenant.findFirst({ where: { active: true } });
    if (!firstTenant) {
      throw new NotFoundException('No existe un Tenant/Organización activa.');
    }
    return firstTenant.id;
  }

  /**
   * Obtener catálogo de productos disponibles con existencias por talla para POS
   */
  async obtenerProductosDisponibles(tenantId: string | null | undefined) {
    const tid = await this.resolveTenantId(tenantId);
    const productos = await this.prisma.product.findMany({
      where: {
        active: true,
        model: { tenantId: tid },
      },
      include: {
        model: true,
        serie: {
          include: {
            tallas: {
              orderBy: { numero: 'asc' },
            },
          },
        },
        stockByTalla: true,
      },
      orderBy: { model: { name: 'asc' } },
    });

    return productos.map((p) => {
      const stockMap = new Map(p.stockByTalla.map((s) => [s.tallaId, s.quantity]));
      const tallas = (p.serie?.tallas || []).map((t) => ({
        tallaId: t.id,
        numero: t.numero,
        cantidad: stockMap.get(t.id) || 0,
      }));

      return {
        id: p.id,
        baseCode: p.model?.baseCode || p.code,
        modelName: p.model?.name || 'Calzado',
        color: p.color || 'Estándar',
        salePrice: Number(p.salePrice || 0),
        serieNombre: p.serie?.nombre || 'General',
        serieId: p.serieId,
        imageUrl: p.imageUrl || undefined,
        tallas,
      };
    });
  }

  /**
   * Abrir una nueva sesión de Caja / Turno POS
   */
  async abrirCaja(tenantId: string | null | undefined, userId: string, dto: AbrirCajaDto) {
    const tid = await this.resolveTenantId(tenantId);
    const cajaAbierta = await this.prisma.cierreCaja.findFirst({
      where: { tenantId: tid, estado: 'ABIERTA' },
    });

    if (cajaAbierta) {
      return cajaAbierta;
    }

    const nuevaCaja = await this.prisma.cierreCaja.create({
      data: {
        tenantId: tid,
        userId,
        montoInicial: dto.montoInicial,
        montoEsperadoEfectivo: dto.montoInicial,
        notas: dto.notas || 'Apertura de turno mostrador POS',
      },
    });

    this.logger.log(`Caja abierta por usuario ${userId} con monto inicial $${dto.montoInicial}`);
    return nuevaCaja;
  }

  /**
   * Consulta el estado de la caja actualmente abierta y sus acumulados
   */
  async obtenerEstadoCaja(tenantId: string | null | undefined) {
    const tid = await this.resolveTenantId(tenantId);
    const cajaAbierta = await this.prisma.cierreCaja.findFirst({
      where: { tenantId: tid, estado: 'ABIERTA' },
      orderBy: { fechaApertura: 'desc' },
    });

    if (!cajaAbierta) {
      return { abierta: false, caja: null };
    }

    return {
      abierta: true,
      caja: {
        ...cajaAbierta,
        montoInicial: Number(cajaAbierta.montoInicial),
        ventasEfectivo: Number(cajaAbierta.ventasEfectivo),
        ventasTarjeta: Number(cajaAbierta.ventasTarjeta),
        ventasTransferencia: Number(cajaAbierta.ventasTransferencia),
        totalVentas: Number(cajaAbierta.totalVentas),
        montoEsperadoEfectivo: Number(cajaAbierta.montoEsperadoEfectivo),
      },
    };
  }

  /**
   * Registra una Venta Directa en Mostrador (POS) con cobro e inventario inmediato
   */
  async registrarVentaDirectaPOS(tenantId: string | null | undefined, userId: string, dto: RegistrarVentaPosDto) {
    const tid = await this.resolveTenantId(tenantId);
    if (!dto.lineas || dto.lineas.length === 0) {
      throw new BadRequestException('Debe incluir al menos un artículo para la venta.');
    }

    // 1. Obtener o asignar Cliente según Tipo de Comprobante (Factura o Consumidor Final)
    let clienteId = dto.clienteId;

    if (dto.tipoComprobante === 'FACTURA' && dto.clienteData) {
      const { cedula, ruc, nombre, apellido, email, telefono, direccion } = dto.clienteData;
      const ident = (cedula || ruc || '').trim();

      let clienteExistente = null;
      if (ident && ident !== '9999999999') {
        const encryptedIdent = this.encryption.encrypt(ident);
        clienteExistente = await this.prisma.client.findFirst({
          where: {
            tenantId: tid,
            OR: [
              { cedula: encryptedIdent },
              { ruc: encryptedIdent },
              { cedula: ident },
              { ruc: ident },
            ],
          },
        });
      }

      if (!clienteExistente) {
        clienteExistente = await this.prisma.client.create({
          data: {
            nombre: nombre?.trim() || 'Cliente Mostrador',
            apellido: (apellido || '').trim() || 'Factura',
            telefono: telefono?.trim() || '0000000000',
            email: email?.trim() || undefined,
            cedula: ident.length === 10 ? this.encryption.encrypt(ident) : undefined,
            ruc: ident.length === 13 ? this.encryption.encrypt(ident) : undefined,
            direccion: direccion?.trim() || undefined,
            nivelCredito: 'SIN_CREDITO',
            tenant: { connect: { id: tid } },
          },
        });
      }
      clienteId = clienteExistente.id;
    } else if (!clienteId) {
      let consumidorFinal = await this.prisma.client.findFirst({
        where: { tenantId: tid, nombre: 'Consumidor Final' },
      });
      if (!consumidorFinal) {
        consumidorFinal = await this.prisma.client.create({
          data: {
            nombre: 'Consumidor',
            apellido: 'Final',
            telefono: '0000000000',
            cedula: this.encryption.encrypt('9999999999'),
            nivelCredito: 'SIN_CREDITO',
            tenant: { connect: { id: tid } },
          },
        });
      }
      clienteId = consumidorFinal.id;
    }

    // 2. Calcular monto total
    const montoTotal = dto.lineas.reduce(
      (acc, item) => acc + item.cantidad * item.precioUnitario,
      0,
    );

    // 3. Ejecutar transacción de venta (Pedido + Stock + Nota + Cobro + Caja)
    const resultado = await this.prisma.$transaction(async (tx) => {
      // A. Descontar Stock y validar existencias
      for (const linea of dto.lineas) {
        const stockTalla = await tx.stockByTalla.findFirst({
          where: { productId: linea.productId, tallaId: linea.tallaId },
        });

        if (!stockTalla || stockTalla.quantity < linea.cantidad) {
          throw new BadRequestException(
            `Stock insuficiente para el producto seleccionado en la talla. Disponible: ${stockTalla?.quantity || 0}`,
          );
        }

        await tx.stockByTalla.update({
          where: { id: stockTalla.id },
          data: { quantity: stockTalla.quantity - linea.cantidad },
        });

        await tx.stockMovement.create({
          data: {
            productId: linea.productId,
            tallaId: linea.tallaId,
            type: MovimientoTipo.VENTA,
            quantity: -linea.cantidad,
            reason: 'Venta directa en mostrador POS',
            userId,
          },
        });
      }

      // B. Crear Pedido ENTREGADO
      const order = await tx.order.create({
        data: {
          tenantId: tid,
          clientId: clienteId,
          userId,
          estado: EstadoPedido.ENTREGADO,
          canal: CanalEntrada.MANUAL,
          tipoPago: TipoPago.CONTADO,
          montoTotal,
          notas: dto.notas || 'Venta directa mostrador POS',
          lines: {
            create: dto.lineas.map((l) => ({
              productId: l.productId,
              serieId: l.serieId,
              tallaId: l.tallaId,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              tipoVenta: TipoVenta.TALLA_ESPECIFICA,
            })),
          },
        },
      });

      // C. Crear Nota de Venta con número correlativo secuencial
      let nextNumero = 1;
      try {
        const lastNote = await tx.saleNote.findFirst({
          orderBy: { numero: 'desc' },
          select: { numero: true },
        });
        nextNumero = (lastNote?.numero || 0) + 1;
      } catch {
        nextNumero = Math.floor(Date.now() / 1000) % 1000000;
      }

      // Obtener detalles de productos y tallas para la nota de venta
      const productIds = dto.lineas.map((l) => l.productId);
      const productosDb = await tx.product.findMany({
        where: { id: { in: productIds } },
        include: { model: true, serie: true },
      });
      const prodMap = new Map(productosDb.map((p) => [p.id, p]));

      const tallaIds = dto.lineas.map((l) => l.tallaId);
      const tallasDb = await tx.tallaConfig.findMany({
        where: { id: { in: tallaIds } },
      });
      const tallasMap = new Map(tallasDb.map((t) => [t.id, t]));

      const saleNote = await tx.saleNote.create({
        data: {
          tenantId: tid,
          numero: nextNumero,
          orderId: order.id,
          clientId: clienteId,
          subtotal: montoTotal,
          descuento: 0,
          total: montoTotal,
          lines: {
            create: dto.lineas.map((l) => {
              const p = prodMap.get(l.productId);
              const t = tallasMap.get(l.tallaId);
              const nombre = p?.model ? `${p.model.name} (${p.color})` : 'Calzado Mostrador POS';
              const serie = p?.serie?.nombre || 'General';
              const talla = t ? String(t.numero) : '38';

              return {
                productId: l.productId,
                nombre,
                serie,
                talla,
                cantidad: l.cantidad,
                precioUnitario: l.precioUnitario,
                subtotal: l.cantidad * l.precioUnitario,
              };
            }),
          },
        },
      });

      // D. Crear Registro de Cobro Saldado
      const cobro = await tx.cobro.create({
        data: {
          tenantId: tid,
          clientId: clienteId,
          saleNoteId: saleNote.id,
          tipo: TipoCobro.CONTADO,
          montoTotal,
          saldoPendiente: 0,
          estado: CobroEstado.SALDADO,
          abonos: {
            create: {
              monto: montoTotal,
              metodo: dto.metodoPago,
              userId,
              notas: `Cobro en mostrador POS via ${dto.metodoPago}`,
            },
          },
        },
      });

      // E. Actualizar acumulación en Cierre de Caja activo si existe
      const cajaAbierta = await tx.cierreCaja.findFirst({
        where: { tenantId: tid, estado: 'ABIERTA' },
      });

      if (cajaAbierta) {
        const updateData: any = {
          totalVentas: Number(cajaAbierta.totalVentas) + montoTotal,
        };

        if (dto.metodoPago === 'EFECTIVO') {
          updateData.ventasEfectivo = Number(cajaAbierta.ventasEfectivo) + montoTotal;
          updateData.montoEsperadoEfectivo = Number(cajaAbierta.montoEsperadoEfectivo) + montoTotal;
        } else if (dto.metodoPago === 'TARJETA') {
          updateData.ventasTarjeta = Number(cajaAbierta.ventasTarjeta) + montoTotal;
        } else if (dto.metodoPago === 'TRANSFERENCIA') {
          updateData.ventasTransferencia = Number(cajaAbierta.ventasTransferencia) + montoTotal;
        }

        await tx.cierreCaja.update({
          where: { id: cajaAbierta.id },
          data: updateData,
        });
      }

      return { order, saleNote, cobro };
    });

    this.logger.log(`Venta POS registrada por $${montoTotal} (${dto.metodoPago})`);
    return resultado;
  }

  /**
   * Cierre de Caja y Arqueo de Período (Cuadre de Turno)
   */
  async cerrarCajaArqueo(tenantId: string | null | undefined, userId: string, dto: CerrarCajaDto) {
    const tid = await this.resolveTenantId(tenantId);
    const cajaAbierta = await this.prisma.cierreCaja.findFirst({
      where: { tenantId: tid, estado: 'ABIERTA' },
    });

    if (!cajaAbierta) {
      throw new NotFoundException('No existe una caja abierta para realizar el arqueo.');
    }

    const montoEsperado = Number(cajaAbierta.montoEsperadoEfectivo);
    const diferencia = dto.montoRealEfectivo - montoEsperado;

    const cajaCerrada = await this.prisma.cierreCaja.update({
      where: { id: cajaAbierta.id },
      data: {
        estado: 'CERRADA',
        fechaCierre: new Date(),
        montoRealEfectivo: dto.montoRealEfectivo,
        diferencia,
        notas: dto.notas ? `${cajaAbierta.notas || ''} | ${dto.notas}` : cajaAbierta.notas,
      },
    });

    this.logger.log(
      `Caja cerrada. Esperado: $${montoEsperado}, Real: $${dto.montoRealEfectivo}, Diferencia: $${diferencia}`,
    );

    return {
      ...cajaCerrada,
      montoInicial: Number(cajaCerrada.montoInicial),
      totalVentas: Number(cajaCerrada.totalVentas),
      montoEsperadoEfectivo: montoEsperado,
      montoRealEfectivo: dto.montoRealEfectivo,
      diferencia,
    };
  }
}
