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
  detallePago?: {
    // Para Transferencia
    banco?: string;
    numeroComprobante?: string;
    // Para Tarjeta
    tipoTarjeta?: string; // "DÉBITO" | "CRÉDITO"
    marcaTarjeta?: string; // "VISA" | "MASTERCARD" | "DINERS" | "DISCOVER" | "OTRA"
    numeroVoucher?: string;
    numeroAutorizacion?: string;
    lote?: string;
    ultimosDigitos?: string;
  };
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

      // Construir descripción detallada de pago si es Transferencia o Tarjeta
      let textoDetallePago = `Cobro directo en tienda (${dto.metodoPago})`;
      if (dto.metodoPago === 'TRANSFERENCIA' && dto.detallePago) {
        const banco = dto.detallePago.banco ? `Banco: ${dto.detallePago.banco}` : '';
        const comp = dto.detallePago.numeroComprobante ? `Comprobante/Ref: #${dto.detallePago.numeroComprobante}` : '';
        const detalles = [banco, comp].filter(Boolean).join(' | ');
        textoDetallePago = detalles ? `Transferencia [${detalles}]` : 'Transferencia Bancaria';
      } else if (dto.metodoPago === 'TARJETA' && dto.detallePago) {
        const tipo = dto.detallePago.tipoTarjeta || 'TARJETA';
        const marca = dto.detallePago.marcaTarjeta ? `(${dto.detallePago.marcaTarjeta})` : '';
        const voucher = dto.detallePago.numeroVoucher ? `Voucher: #${dto.detallePago.numeroVoucher}` : '';
        const aut = dto.detallePago.numeroAutorizacion ? `Aut: #${dto.detallePago.numeroAutorizacion}` : '';
        const lote = dto.detallePago.lote ? `Lote: #${dto.detallePago.lote}` : '';
        const detalles = [voucher, aut, lote].filter(Boolean).join(' | ');
        textoDetallePago = `${tipo} ${marca} [${detalles || 'Cobro Datafast/Medianet'}]`.trim();
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
          notas: dto.notas ? `${dto.notas} - ${textoDetallePago}` : textoDetallePago,
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

      // D. Crear Registro de Cobro Saldado con el detalle específico
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
              notas: textoDetallePago,
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

  /**
   * Obtiene la lista de vendedores/usuarios habilitados para filtros en POS
   */
  async obtenerVendedoresPOS(
    tenantId: string | null | undefined,
    requestingUserId: string,
    userRole: string,
    esAdminGeneral?: boolean,
  ) {
    const tid = await this.resolveTenantId(tenantId);
    const isAdmin = userRole === 'ROL_ADMIN' || userRole === 'ROL_SUPER_ADMIN' || !!esAdminGeneral;

    if (!isAdmin) {
      const u = await this.prisma.user.findUnique({
        where: { id: requestingUserId },
        select: { id: true, nombre: true, email: true, rol: true },
      });
      return u ? [u] : [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { tenantId: tid },
          { id: requestingUserId },
        ],
        activo: true,
      },
      select: { id: true, nombre: true, email: true, rol: true },
      orderBy: { nombre: 'asc' },
    });

    return users;
  }

  /**
   * Historial analítico de ventas realizadas por POS con filtros por período, rol y empleado
   */
  async obtenerHistorialVentasPOS(
    tenantId: string | null | undefined,
    requestingUserId: string,
    userRole: string,
    esAdminGeneral: boolean | undefined,
    filtros: {
      periodo?: string;
      fechaInicio?: string;
      fechaFin?: string;
      userId?: string;
      metodoPago?: string;
      busqueda?: string;
    },
  ) {
    const tid = await this.resolveTenantId(tenantId);
    const isAdmin = userRole === 'ROL_ADMIN' || userRole === 'ROL_SUPER_ADMIN' || !!esAdminGeneral;

    // Restricción estricta de seguridad por Rol: Si no es admin, solo consulta sus propias ventas
    let targetUserId: string | undefined = undefined;
    if (!isAdmin) {
      targetUserId = requestingUserId;
    } else if (filtros.userId && filtros.userId !== 'TODOS') {
      targetUserId = filtros.userId;
    }

    // Cálculo dinámico de fechas según período
    const now = new Date();
    let start: Date;
    let end: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const periodo = filtros.periodo || 'dia';

    switch (periodo) {
      case 'dia':
      default:
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        break;
      case 'semana': {
        const dayOfWeek = (now.getDay() + 6) % 7; // Lunes = 0
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek, 0, 0, 0, 0);
        break;
      }
      case 'mes':
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
      case 'trimestre': {
        const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), quarterMonth, 1, 0, 0, 0, 0);
        break;
      }
      case 'anio':
        start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        break;
      case 'custom':
        if (filtros.fechaInicio) {
          const parts = filtros.fechaInicio.split('-').map(Number);
          start = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
        } else {
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        }
        if (filtros.fechaFin) {
          const parts = filtros.fechaFin.split('-').map(Number);
          end = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999);
        }
        break;
      case 'todos':
        start = new Date(2020, 0, 1, 0, 0, 0, 0);
        break;
    }

    // Consulta de pedidos registrados vía mostrador (Canal MANUAL)
    const whereClause: any = {
      tenantId: tid,
      canal: CanalEntrada.MANUAL,
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    if (targetUserId) {
      whereClause.userId = targetUserId;
    }

    const orders = await this.prisma.order.findMany({
      where: whereClause,
      include: {
        lines: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const orderIds = orders.map((o) => o.id);
    const clientIds = Array.from(new Set(orders.map((o) => o.clientId)));
    const userIds = Array.from(new Set(orders.map((o) => o.userId)));

    // Obtener notas de entrega/venta relacionadas
    const saleNotes = await this.prisma.saleNote.findMany({
      where: { orderId: { in: orderIds } },
      include: {
        lines: true,
        cobro: {
          include: {
            abonos: true,
          },
        },
      },
    });
    const saleNoteMap = new Map(saleNotes.map((sn) => [sn.orderId, sn]));

    // Obtener clientes
    const clients = await this.prisma.client.findMany({
      where: { id: { in: clientIds } },
    });
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    // Obtener usuarios/vendedores
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nombre: true, email: true, rol: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Obtener productos para imágenes y detalles adicionales
    const productIds = Array.from(
      new Set(orders.flatMap((o) => o.lines.map((l) => l.productId))),
    );
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        model: true,
        serie: true,
      },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Transformación y armado de datos
    let ventas = orders.map((order) => {
      const sn = saleNoteMap.get(order.id);
      const client = clientMap.get(order.clientId);
      const user = userMap.get(order.userId);

      // Desencriptar datos del cliente
      let cedula = '';
      if (client?.cedula) {
        try {
          cedula = this.encryption.decrypt(client.cedula);
        } catch {
          cedula = client.cedula;
        }
      } else if (client?.ruc) {
        try {
          cedula = this.encryption.decrypt(client.ruc);
        } catch {
          cedula = client.ruc;
        }
      }

      const nombreCliente = client
        ? `${client.nombre} ${client.apellido || ''}`.trim()
        : 'Consumidor Final';

      // Método de pago principal del cobro
      const abono = sn?.cobro?.abonos?.[0];
      let metodoPago = 'EFECTIVO';
      let detallePago = '';

      if (abono?.metodo) {
        metodoPago = abono.metodo;
        detallePago = abono.notas || '';
      } else if (order.notas?.includes('TARJETA')) {
        metodoPago = 'TARJETA';
        detallePago = order.notas;
      } else if (order.notas?.includes('TRANSFERENCIA')) {
        metodoPago = 'TRANSFERENCIA';
        detallePago = order.notas;
      }

      // Detalle de líneas
      const lineas = (sn?.lines && sn.lines.length > 0)
        ? sn.lines.map((sl) => {
            const prod = productMap.get(sl.productId);
            return {
              productId: sl.productId,
              nombre: sl.nombre,
              serie: sl.serie,
              talla: sl.talla,
              cantidad: sl.cantidad,
              precioUnitario: Number(sl.precioUnitario),
              subtotal: Number(sl.subtotal),
              color: prod?.color || '',
              modelName: prod?.model?.name || sl.nombre,
              baseCode: prod?.model?.baseCode || prod?.code || '',
              imageUrl: prod?.imageUrl || undefined,
            };
          })
        : order.lines.map((ol) => {
            const prod = productMap.get(ol.productId);
            const modelName = prod?.model?.name || 'Calzado Mostrador';
            const color = prod?.color || '';
            const serie = prod?.serie?.nombre || 'General';
            return {
              productId: ol.productId,
              nombre: `${modelName} (${color})`,
              serie,
              talla: '38',
              cantidad: ol.cantidad,
              precioUnitario: Number(ol.precioUnitario),
              subtotal: ol.cantidad * Number(ol.precioUnitario),
              color,
              modelName,
              baseCode: prod?.model?.baseCode || prod?.code || '',
              imageUrl: prod?.imageUrl || undefined,
            };
          });

      const totalPares = lineas.reduce((acc, l) => acc + l.cantidad, 0);

      return {
        id: order.id,
        saleNoteId: sn?.id,
        numeroNota: sn?.numero ? `#${String(sn.numero).padStart(6, '0')}` : `#${order.id.slice(0, 8)}`,
        fecha: order.createdAt,
        total: Number(order.montoTotal),
        subtotal: Number(sn?.subtotal || order.montoTotal),
        descuento: Number(sn?.descuento || 0),
        metodoPago,
        detallePago,
        vendedor: {
          id: user?.id || order.userId,
          nombre: user?.nombre || 'Vendedor POS',
          email: user?.email || '',
          rol: user?.rol || 'ROL_VENDEDOR',
        },
        cliente: {
          id: client?.id || order.clientId,
          nombre: nombreCliente,
          cedula: cedula || '9999999999',
          telefono: client?.telefono || '',
          email: client?.email || '',
          direccion: client?.direccion || '',
        },
        totalPares,
        lineas,
        notas: order.notas || '',
      };
    });

    // Filtro por método de pago si se solicita
    if (filtros.metodoPago && filtros.metodoPago !== 'TODOS') {
      ventas = ventas.filter((v) => v.metodoPago.toUpperCase() === filtros.metodoPago?.toUpperCase());
    }

    // Filtro por búsqueda textual (comprobante, cliente, modelo, código)
    if (filtros.busqueda && filtros.busqueda.trim()) {
      const q = filtros.busqueda.trim().toLowerCase();
      ventas = ventas.filter((v) => {
        const matchesNumero = v.numeroNota.toLowerCase().includes(q);
        const matchesCliente = v.cliente.nombre.toLowerCase().includes(q) || v.cliente.cedula.includes(q);
        const matchesVendedor = v.vendedor.nombre.toLowerCase().includes(q);
        const matchesItems = v.lineas.some((l) =>
          l.nombre.toLowerCase().includes(q) ||
          l.modelName.toLowerCase().includes(q) ||
          l.color.toLowerCase().includes(q) ||
          l.baseCode.toLowerCase().includes(q),
        );
        return matchesNumero || matchesCliente || matchesVendedor || matchesItems;
      });
    }

    // Cálculo de Métricas Resumen (KPIs)
    const totalRecaudado = ventas.reduce((sum, v) => sum + v.total, 0);
    const cantidadVentas = ventas.length;
    const cantidadPares = ventas.reduce((sum, v) => sum + v.totalPares, 0);
    const ticketPromedio = cantidadVentas > 0 ? totalRecaudado / cantidadVentas : 0;

    // Desglose por Método de Pago
    const desgloseMetodosPago = {
      efectivo: { total: 0, cantidad: 0 },
      tarjeta: { total: 0, cantidad: 0 },
      transferencia: { total: 0, cantidad: 0 },
    };

    ventas.forEach((v) => {
      const m = v.metodoPago.toUpperCase();
      if (m === 'EFECTIVO') {
        desgloseMetodosPago.efectivo.total += v.total;
        desgloseMetodosPago.efectivo.cantidad += 1;
      } else if (m === 'TARJETA') {
        desgloseMetodosPago.tarjeta.total += v.total;
        desgloseMetodosPago.tarjeta.cantidad += 1;
      } else if (m === 'TRANSFERENCIA') {
        desgloseMetodosPago.transferencia.total += v.total;
        desgloseMetodosPago.transferencia.cantidad += 1;
      }
    });

    // Desglose por Vendedor (para admin)
    const vendedorMap = new Map<string, { userId: string; nombre: string; email: string; total: number; ventas: number; pares: number }>();
    ventas.forEach((v) => {
      const vid = v.vendedor.id;
      const exist = vendedorMap.get(vid);
      if (exist) {
        exist.total += v.total;
        exist.ventas += 1;
        exist.pares += v.totalPares;
      } else {
        vendedorMap.set(vid, {
          userId: vid,
          nombre: v.vendedor.nombre,
          email: v.vendedor.email,
          total: v.total,
          ventas: 1,
          pares: v.totalPares,
        });
      }
    });
    const desgloseVendedores = Array.from(vendedorMap.values()).sort((a, b) => b.total - a.total);

    // Top Modelos Vendidos en el Período
    const modeloStatsMap = new Map<string, { nombre: string; pares: number; total: number }>();
    ventas.forEach((v) => {
      v.lineas.forEach((l) => {
        const key = l.modelName || l.nombre;
        const cur = modeloStatsMap.get(key);
        if (cur) {
          cur.pares += l.cantidad;
          cur.total += l.subtotal;
        } else {
          modeloStatsMap.set(key, {
            nombre: key,
            pares: l.cantidad,
            total: l.subtotal,
          });
        }
      });
    });
    const topModelos = Array.from(modeloStatsMap.values())
      .sort((a, b) => b.pares - a.pares)
      .slice(0, 5);

    return {
      periodo,
      rangoFechas: {
        desde: start.toISOString(),
        hasta: end.toISOString(),
      },
      metricas: {
        totalRecaudado: Number(totalRecaudado.toFixed(2)),
        cantidadVentas,
        cantidadPares,
        ticketPromedio: Number(ticketPromedio.toFixed(2)),
        desgloseMetodosPago: {
          efectivo: {
            total: Number(desgloseMetodosPago.efectivo.total.toFixed(2)),
            cantidad: desgloseMetodosPago.efectivo.cantidad,
          },
          tarjeta: {
            total: Number(desgloseMetodosPago.tarjeta.total.toFixed(2)),
            cantidad: desgloseMetodosPago.tarjeta.cantidad,
          },
          transferencia: {
            total: Number(desgloseMetodosPago.transferencia.total.toFixed(2)),
            cantidad: desgloseMetodosPago.transferencia.cantidad,
          },
        },
        desgloseVendedores,
        topModelos,
      },
      ventas,
    };
  }
}
