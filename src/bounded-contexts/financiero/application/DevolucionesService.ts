import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';

export interface LineaDevolucionClienteInput {
  productId: string;
  tallaId: string;
  cantidad: number;
  precioUnitario: number;
}

export interface LineaDevolucionProveedorInput {
  productId: string;
  tallaId: string;
  cantidad: number;
  precioCosto: number;
}

@Injectable()
export class DevolucionesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registrar devolucion de cliente:
   * 1. Reingresa o Da de Baja el stock segun destinoStock.
   * 2. Descuenta la deuda del cliente usando FIFO (cobros mas antiguos primero).
   * 3. Si totalDevuelto > deudaTotal, registra saldoAFavor en Client.
   * 4. Si destinoStock = BAJA_POR_FALLA, marca como PENDIENTE_DEVOLUCION_PROVEEDOR.
   * 5. Registra MovimientoFinanciero como bitacora.
   */
  async registrarDevolucionCliente(
    dto: {
      saleNoteId?: string;
      orderId?: string;
      clientId: string;
      motivo: string;
      tipoDevolucion?: 'SERIE_COMPLETA' | 'TALLA_ESPECIFICA';
      destinoStock?: 'REINGRESO_INVENTARIO' | 'BAJA_POR_FALLA';
      lines: LineaDevolucionClienteInput[];
    },
    tenantId: string,
    userId?: string,
  ) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Debes incluir al menos una linea de producto a devolver.');
    }

    const destinoStock = dto.destinoStock || 'REINGRESO_INVENTARIO';
    const tipoDevolucion = dto.tipoDevolucion || 'TALLA_ESPECIFICA';

    const totalDevuelto = dto.lines.reduce(
      (acc, l) => acc + l.cantidad * l.precioUnitario,
      0,
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Manejo del Stock
      if (destinoStock === 'REINGRESO_INVENTARIO') {
        for (const line of dto.lines) {
          if (line.productId && line.productId !== 'sin-especificar') {
            const stockTalla = await tx.stockByTalla.findFirst({
              where: { productId: line.productId, tallaId: line.tallaId },
            });

            if (stockTalla) {
              await tx.stockByTalla.update({
                where: { id: stockTalla.id },
                data: { quantity: stockTalla.quantity + line.cantidad },
              });
            }
          }
        }
      }

      // 2. Descuento FIFO de deuda del cliente
      let montoRestante = totalDevuelto;
      let deudaDescontadaTotal = 0;

      // Obtener todos los cobros pendientes del cliente ordenados por fecha (FIFO)
      const cobrosPendientes = await tx.cobro.findMany({
        where: {
          clientId: dto.clientId,
          tenantId,
          saldoPendiente: { gt: 0 },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Si hay un saleNoteId especifico, priorizarlo
      if (dto.saleNoteId) {
        const cobroEspecifico = cobrosPendientes.find((c) => c.saleNoteId === dto.saleNoteId);
        if (cobroEspecifico) {
          // Mover al inicio para priorizarlo
          const idx = cobrosPendientes.indexOf(cobroEspecifico);
          cobrosPendientes.splice(idx, 1);
          cobrosPendientes.unshift(cobroEspecifico);
        }
      }

      for (const cobro of cobrosPendientes) {
        if (montoRestante <= 0) break;

        const saldoActual = Number(cobro.saldoPendiente);
        const descuento = Math.min(montoRestante, saldoActual);

        const nuevoSaldo = saldoActual - descuento;
        const nuevoMonto = Math.max(0, Number(cobro.montoTotal) - descuento);
        const nuevoEstado = nuevoSaldo === 0 ? 'SALDADO' : cobro.estado;

        await tx.cobro.update({
          where: { id: cobro.id },
          data: {
            saldoPendiente: nuevoSaldo,
            montoTotal: nuevoMonto,
            estado: nuevoEstado,
          },
        });

        montoRestante -= descuento;
        deudaDescontadaTotal += descuento;

        // Registrar movimiento financiero por cada cobro afectado
        await tx.movimientoFinanciero.create({
          data: {
            tenantId,
            tipo: 'DESCUENTO_DEVOLUCION_CLIENTE',
            referenciaId: cobro.id,
            referenciaTabla: 'Cobro',
            clientId: dto.clientId,
            monto: descuento,
            descripcion: `Descuento de $${descuento.toFixed(2)} aplicado al cobro por devolucion de cliente`,
            userId: userId || null,
          },
        });
      }

      // 3. Calcular saldo a favor del cliente
      const saldoAFavor = Math.max(0, montoRestante);

      // Si hay saldo a favor, actualizar el acumulado del cliente
      if (saldoAFavor > 0) {
        const clienteActual = await tx.client.findUnique({ where: { id: dto.clientId } });
        const saldoAnterior = clienteActual ? Number(clienteActual.saldoAFavor) : 0;

        await tx.client.update({
          where: { id: dto.clientId },
          data: { saldoAFavor: saldoAnterior + saldoAFavor },
        });

        // Registrar movimiento de saldo a favor
        await tx.movimientoFinanciero.create({
          data: {
            tenantId,
            tipo: 'SALDO_FAVOR_CLIENTE',
            referenciaId: dto.clientId,
            referenciaTabla: 'Client',
            clientId: dto.clientId,
            monto: saldoAFavor,
            descripcion: `Saldo a favor de $${saldoAFavor.toFixed(2)} generado por devolucion (total devuelto: $${totalDevuelto.toFixed(2)}, deuda descontada: $${deudaDescontadaTotal.toFixed(2)})`,
            userId: userId || null,
          },
        });
      }

      // 4. Determinar estado segun destino del stock
      const estadoDevolucion = destinoStock === 'BAJA_POR_FALLA'
        ? 'PENDIENTE_DEVOLUCION_PROVEEDOR'
        : 'COMPLETADO';

      // 5. Crear registro de devolucion con datos financieros
      const motivoCompleto = `[${destinoStock === 'BAJA_POR_FALLA' ? 'MERMA/BAJA POR FALLA' : 'REINGRESO A BODEGA'}] [${tipoDevolucion === 'SERIE_COMPLETA' ? 'SERIE COMPLETA' : 'TALLA ESPECIFICA'}] ${dto.motivo || 'Devolucion de cliente'}`;

      const devolucion = await tx.clienteDevolucion.create({
        data: {
          tenantId,
          saleNoteId: dto.saleNoteId || null,
          orderId: dto.orderId,
          clientId: dto.clientId,
          motivo: motivoCompleto,
          totalDevuelto,
          estado: estadoDevolucion,
          destinoStock,
          deudaDescontada: deudaDescontadaTotal,
          saldoAFavor,
          saldoAFavorPagado: false,
          lines: {
            create: dto.lines.map((l) => ({
              productId: l.productId,
              tallaId: l.tallaId,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              subtotal: l.cantidad * l.precioUnitario,
            })),
          },
        },
        include: { lines: true },
      });

      return {
        ...devolucion,
        resumenFinanciero: {
          totalDevuelto,
          deudaDescontada: deudaDescontadaTotal,
          saldoAFavor,
          cobrosAfectados: cobrosPendientes.filter((_, i) => {
            let acum = 0;
            for (let j = 0; j <= i; j++) {
              acum += Number(cobrosPendientes[j].saldoPendiente);
            }
            return acum > 0 && acum <= totalDevuelto + Number(cobrosPendientes[i].saldoPendiente);
          }).length,
          mensaje: saldoAFavor > 0
            ? `Se desconto $${deudaDescontadaTotal.toFixed(2)} de la deuda. El cliente tiene $${saldoAFavor.toFixed(2)} a favor.`
            : `Se desconto $${deudaDescontadaTotal.toFixed(2)} de la deuda del cliente.`,
        },
      };
    });
  }

  /**
   * Listar devoluciones de clientes por tenant.
   */
  async listarDevolucionesCliente(tenantId: string) {
    return this.prisma.clienteDevolucion.findMany({
      where: { tenantId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Listar devoluciones pendientes de enviar al proveedor (BAJA_POR_FALLA).
   * Enriquecido con nombres de modelo, tallas, fotos y proveedores asociados.
   */
  async listarPendientesProveedor(tenantId: string) {
    const devoluciones = await this.prisma.clienteDevolucion.findMany({
      where: {
        tenantId,
        estado: 'PENDIENTE_DEVOLUCION_PROVEEDOR',
      },
      include: {
        lines: true,
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const allProductIds = Array.from(
      new Set(devoluciones.flatMap((d) => d.lines.map((l) => l.productId)).filter(Boolean)),
    );
    const allTallaIds = Array.from(
      new Set(devoluciones.flatMap((d) => d.lines.map((l) => l.tallaId)).filter(Boolean)),
    );

    const [products, tallas, clients] = await Promise.all([
      allProductIds.length > 0
        ? this.prisma.product.findMany({
            where: { id: { in: allProductIds } },
            include: {
              model: {
                include: {
                  supplier: { select: { id: true, razonSocial: true, contacto: true } },
                },
              },
              serie: true,
            },
          })
        : [],
      allTallaIds.length > 0
        ? this.prisma.tallaConfig.findMany({
            where: { id: { in: allTallaIds } },
          })
        : [],
      this.prisma.client.findMany({
        where: { id: { in: Array.from(new Set(devoluciones.map((d) => d.clientId))) } },
        select: { id: true, nombre: true, apellido: true, telefono: true },
      }),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const tallaMap = new Map(tallas.map((t) => [t.id, t.numero]));
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    return devoluciones.map((d) => {
      const client = clientMap.get(d.clientId);
      return {
        ...d,
        totalDevuelto: Number(d.totalDevuelto),
        deudaDescontada: Number(d.deudaDescontada),
        saldoAFavor: Number(d.saldoAFavor),
        clienteNombre: client ? `${client.nombre} ${client.apellido}`.trim() : 'Cliente sin registrar',
        clienteTelefono: client?.telefono || '',
        lines: d.lines.map((l) => {
          const prod = productMap.get(l.productId);
          const numTalla = tallaMap.get(l.tallaId);
          return {
            ...l,
            cantidad: l.cantidad,
            precioUnitario: Number(l.precioUnitario),
            subtotal: Number(l.subtotal),
            numeroTalla: numTalla ?? 38,
            modelName: prod?.model?.name || 'Calzado Defectuoso',
            brand: prod?.model?.brand || '',
            color: prod?.color || '',
            imageUrl: prod?.imageUrl || null,
            costPrice: prod ? Number(prod.costPrice) : Number(l.precioUnitario),
            supplierId: prod?.model?.supplierId || null,
            supplierNombre: prod?.model?.supplier?.razonSocial || null,
          };
        }),
      };
    });
  }

  /**
   * Registrar manualmente mercadería por devolver / producto defectuoso
   */
  async registrarMercaderiaPorDevolverManual(
    dto: {
      motivo: string;
      clientId?: string;
      lines: {
        productId: string;
        tallaId: string;
        cantidad: number;
        precioUnitario?: number;
      }[];
    },
    tenantId: string,
    userId?: string,
  ) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Debes incluir al menos un modelo a devolver.');
    }

    // Si no hay clientId, buscar o usar cliente genérico de tienda
    let finalClientId = dto.clientId;
    if (!finalClientId) {
      const genericClient = await this.prisma.client.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      });
      finalClientId = genericClient?.id || 'manual-store';
    }

    const totalDevuelto = dto.lines.reduce(
      (acc, l) => acc + l.cantidad * (l.precioUnitario || 0),
      0,
    );

    const devolucion = await this.prisma.clienteDevolucion.create({
      data: {
        tenantId,
        clientId: finalClientId,
        motivo: `[MANUAL/BODEGA] ${dto.motivo || 'Calzado defectuoso separado para devolución a proveedor'}`,
        totalDevuelto,
        estado: 'PENDIENTE_DEVOLUCION_PROVEEDOR',
        destinoStock: 'BAJA_POR_FALLA',
        deudaDescontada: 0,
        saldoAFavor: 0,
        saldoAFavorPagado: true,
        lines: {
          create: dto.lines.map((l) => ({
            productId: l.productId,
            tallaId: l.tallaId,
            cantidad: l.cantidad,
            precioUnitario: l.precioUnitario || 0,
            subtotal: l.cantidad * (l.precioUnitario || 0),
          })),
        },
      },
      include: { lines: true },
    });

    return devolucion;
  }

  /**
   * Pagar excedente al cliente (en efectivo).
   * Marca la devolucion como pagada y resta del saldo a favor acumulado.
   */
  async pagarExcedenteCliente(
    devolucionId: string,
    tenantId: string,
    userId?: string,
    metodo?: string,
  ) {
    const devolucion = await this.prisma.clienteDevolucion.findFirst({
      where: { id: devolucionId, tenantId },
    });

    if (!devolucion) {
      throw new NotFoundException('Devolucion no encontrada.');
    }

    if (devolucion.saldoAFavorPagado) {
      throw new BadRequestException('El excedente de esta devolucion ya fue pagado o aplicado.');
    }

    const saldoAFavor = Number(devolucion.saldoAFavor);
    if (saldoAFavor <= 0) {
      throw new BadRequestException('Esta devolucion no tiene saldo a favor.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Marcar como pagado
      await tx.clienteDevolucion.update({
        where: { id: devolucionId },
        data: { saldoAFavorPagado: true },
      });

      // Restar del acumulado del cliente
      const cliente = await tx.client.findUnique({ where: { id: devolucion.clientId } });
      if (cliente) {
        const nuevoSaldo = Math.max(0, Number(cliente.saldoAFavor) - saldoAFavor);
        await tx.client.update({
          where: { id: devolucion.clientId },
          data: { saldoAFavor: nuevoSaldo },
        });
      }

      // Registrar movimiento
      await tx.movimientoFinanciero.create({
        data: {
          tenantId,
          tipo: 'PAGO_EXCEDENTE_CLIENTE',
          referenciaId: devolucionId,
          referenciaTabla: 'ClienteDevolucion',
          clientId: devolucion.clientId,
          monto: saldoAFavor,
          descripcion: `Pago en ${metodo || 'efectivo'} de $${saldoAFavor.toFixed(2)} al cliente por excedente de devolucion`,
          userId: userId || null,
        },
      });

      return { success: true, montoPagado: saldoAFavor, metodo: metodo || 'EFECTIVO' };
    });
  }

  /**
   * Aplicar saldo a favor del cliente en un cobro existente ("hacer paso").
   * Descuenta del saldo acumulado y lo aplica como abono al cobro.
   */
  async aplicarSaldoFavorCliente(
    dto: {
      clientId: string;
      cobroId: string;
      montoAplicar?: number; // Si no se especifica, aplica todo el saldo disponible
    },
    tenantId: string,
    userId?: string,
  ) {
    const cliente = await this.prisma.client.findFirst({
      where: { id: dto.clientId, tenantId },
    });

    if (!cliente || Number(cliente.saldoAFavor) <= 0) {
      throw new BadRequestException('El cliente no tiene saldo a favor disponible.');
    }

    const cobro = await this.prisma.cobro.findFirst({
      where: { id: dto.cobroId, tenantId },
    });

    if (!cobro || Number(cobro.saldoPendiente) <= 0) {
      throw new BadRequestException('El cobro no tiene saldo pendiente.');
    }

    const saldoDisponible = Number(cliente.saldoAFavor);
    const saldoPendienteCobro = Number(cobro.saldoPendiente);
    const montoAplicar = dto.montoAplicar
      ? Math.min(dto.montoAplicar, saldoDisponible, saldoPendienteCobro)
      : Math.min(saldoDisponible, saldoPendienteCobro);

    if (montoAplicar <= 0) {
      throw new BadRequestException('El monto a aplicar debe ser mayor a cero.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Descontar del cobro
      const nuevoSaldoCobro = saldoPendienteCobro - montoAplicar;
      const nuevoEstadoCobro = nuevoSaldoCobro === 0 ? 'SALDADO' : cobro.estado === 'PENDIENTE' ? 'PARCIALMENTE_PAGADO' : cobro.estado;

      await tx.cobro.update({
        where: { id: dto.cobroId },
        data: {
          saldoPendiente: nuevoSaldoCobro,
          estado: nuevoEstadoCobro,
        },
      });

      // Descontar del saldo a favor del cliente
      const nuevoSaldoCliente = Math.max(0, saldoDisponible - montoAplicar);
      await tx.client.update({
        where: { id: dto.clientId },
        data: { saldoAFavor: nuevoSaldoCliente },
      });

      // Marcar las devoluciones relacionadas si se agoto el saldo
      if (nuevoSaldoCliente === 0) {
        await tx.clienteDevolucion.updateMany({
          where: { clientId: dto.clientId, tenantId, saldoAFavorPagado: false, saldoAFavor: { gt: 0 } },
          data: { saldoAFavorPagado: true },
        });
      }

      // Registrar movimiento
      await tx.movimientoFinanciero.create({
        data: {
          tenantId,
          tipo: 'PASO_MERCADERIA_CLIENTE',
          referenciaId: dto.cobroId,
          referenciaTabla: 'Cobro',
          clientId: dto.clientId,
          monto: montoAplicar,
          descripcion: `Hacer paso: $${montoAplicar.toFixed(2)} del saldo a favor aplicado al cobro (saldo restante: $${nuevoSaldoCliente.toFixed(2)})`,
          userId: userId || null,
        },
      });

      return {
        success: true,
        montoAplicado: montoAplicar,
        saldoRestanteCliente: nuevoSaldoCliente,
        saldoRestanteCobro: nuevoSaldoCobro,
      };
    });
  }

  /**
   * Registrar devolucion a proveedor (garantia / mercancia defectuosa):
   * 1. Descuenta el stock fisico por producto y talla.
   * 2. Descuenta FIFO de DeudaProveedor.
   * 3. Si totalDevuelto > deuda, registra saldoAFavor en Supplier.
   * 4. Registra el historial de ProveedorDevolucion.
   */
  async registrarDevolucionProveedor(
    dto: {
      entradaId?: string;
      supplierId: string;
      motivo: string;
      clienteDevolucionId?: string;
      lines: LineaDevolucionProveedorInput[];
    },
    tenantId: string,
    userId?: string,
  ) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Debes incluir al menos una linea de producto a devolver al proveedor.');
    }

    const totalDevuelto = dto.lines.reduce(
      (acc, l) => acc + l.cantidad * l.precioCosto,
      0,
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Descontar stock por cada linea
      for (const line of dto.lines) {
        const stockTalla = await tx.stockByTalla.findFirst({
          where: { productId: line.productId, tallaId: line.tallaId },
        });

        if (stockTalla) {
          const nuevaCant = Math.max(0, stockTalla.quantity - line.cantidad);
          await tx.stockByTalla.update({
            where: { id: stockTalla.id },
            data: { quantity: nuevaCant },
          });
        }
      }

      // 2. Descuento FIFO de DeudaProveedor
      let montoRestante = totalDevuelto;
      let deudaDescontadaTotal = 0;

      const deudasPendientes = await tx.deudaProveedor.findMany({
        where: {
          supplierId: dto.supplierId,
          tenantId,
          saldoPendiente: { gt: 0 },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Si hay entradaId especifico, priorizarlo
      if (dto.entradaId) {
        const deudaEspecifica = deudasPendientes.find((d) => d.entradaId === dto.entradaId);
        if (deudaEspecifica) {
          const idx = deudasPendientes.indexOf(deudaEspecifica);
          deudasPendientes.splice(idx, 1);
          deudasPendientes.unshift(deudaEspecifica);
        }
      }

      for (const deuda of deudasPendientes) {
        if (montoRestante <= 0) break;

        const saldoActual = Number(deuda.saldoPendiente);
        const descuento = Math.min(montoRestante, saldoActual);

        const nuevoSaldo = saldoActual - descuento;
        const nuevoMonto = Math.max(0, Number(deuda.montoTotal) - descuento);
        const nuevoEstado = nuevoSaldo === 0 ? 'SALDADO' : deuda.estado;

        await tx.deudaProveedor.update({
          where: { id: deuda.id },
          data: {
            saldoPendiente: nuevoSaldo,
            montoTotal: nuevoMonto,
            estado: nuevoEstado,
          },
        });

        montoRestante -= descuento;
        deudaDescontadaTotal += descuento;

        // Registrar movimiento
        await tx.movimientoFinanciero.create({
          data: {
            tenantId,
            tipo: 'DESCUENTO_DEVOLUCION_PROVEEDOR',
            referenciaId: deuda.id,
            referenciaTabla: 'DeudaProveedor',
            supplierId: dto.supplierId,
            monto: descuento,
            descripcion: `Descuento de $${descuento.toFixed(2)} aplicado a deuda con proveedor por devolucion`,
            userId: userId || null,
          },
        });
      }

      // 3. Calcular saldo a favor del negocio
      const saldoAFavor = Math.max(0, montoRestante);

      if (saldoAFavor > 0) {
        const proveedorActual = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
        const saldoAnterior = proveedorActual ? Number(proveedorActual.saldoAFavorNegocio) : 0;

        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { saldoAFavorNegocio: saldoAnterior + saldoAFavor },
        });

        await tx.movimientoFinanciero.create({
          data: {
            tenantId,
            tipo: 'SALDO_FAVOR_NEGOCIO',
            referenciaId: dto.supplierId,
            referenciaTabla: 'Supplier',
            supplierId: dto.supplierId,
            monto: saldoAFavor,
            descripcion: `Saldo a favor del negocio de $${saldoAFavor.toFixed(2)} por devolucion al proveedor (total devuelto: $${totalDevuelto.toFixed(2)}, deuda descontada: $${deudaDescontadaTotal.toFixed(2)})`,
            userId: userId || null,
          },
        });
      }

      // 4. Si viene de una devolucion de cliente, marcar como procesada
      if (dto.clienteDevolucionId) {
        await tx.clienteDevolucion.update({
          where: { id: dto.clienteDevolucionId },
          data: { estado: 'COMPLETADO' },
        });
      }

      // 5. Asignar correlativo DEV-XXXX
      const lastDev = await tx.proveedorDevolucion.findFirst({
        where: { tenantId },
        orderBy: { numero: 'desc' },
      });
      const nextNumero = (lastDev?.numero ?? 0) + 1;

      // 6. Crear registro de devolucion a proveedor
      const devolucion = await tx.proveedorDevolucion.create({
        data: {
          tenantId,
          numero: nextNumero,
          entradaId: dto.entradaId,
          supplierId: dto.supplierId,
          motivo: dto.motivo,
          totalDevuelto,
          clienteDevolucionId: dto.clienteDevolucionId || null,
          deudaDescontada: deudaDescontadaTotal,
          saldoAFavor,
          saldoAFavorPagado: false,
          lines: {
            create: dto.lines.map((l) => ({
              productId: l.productId,
              tallaId: l.tallaId,
              cantidad: l.cantidad,
              precioCosto: l.precioCosto,
              subtotal: l.cantidad * l.precioCosto,
            })),
          },
        },
        include: { lines: true },
      });

      return {
        ...devolucion,
        resumenFinanciero: {
          numeroCodigo: `DEV-${String(nextNumero).padStart(4, '0')}`,
          totalDevuelto,
          deudaDescontada: deudaDescontadaTotal,
          saldoAFavor,
          mensaje: saldoAFavor > 0
            ? `Se descontó $${deudaDescontadaTotal.toFixed(2)} de la deuda. Saldo a favor del negocio: $${saldoAFavor.toFixed(2)}.`
            : `Se descontó $${deudaDescontadaTotal.toFixed(2)} de la deuda con el proveedor.`,
        },
      };
    });
  }

  /**
   * Listar devoluciones a proveedores por tenant con enriquecimiento de productos y tallas.
   */
  async listarDevolucionesProveedor(tenantId: string) {
    const devoluciones = await this.prisma.proveedorDevolucion.findMany({
      where: { tenantId },
      include: {
        lines: true,
        supplier: {
          select: { id: true, razonSocial: true, ruc: true, contacto: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const allProductIds = Array.from(
      new Set(devoluciones.flatMap((d) => d.lines.map((l) => l.productId)).filter(Boolean)),
    );
    const allTallaIds = Array.from(
      new Set(devoluciones.flatMap((d) => d.lines.map((l) => l.tallaId)).filter(Boolean)),
    );

    const [products, tallas] = await Promise.all([
      allProductIds.length > 0
        ? this.prisma.product.findMany({
            where: { id: { in: allProductIds } },
            include: { model: true, serie: true },
          })
        : [],
      allTallaIds.length > 0
        ? this.prisma.tallaConfig.findMany({
            where: { id: { in: allTallaIds } },
          })
        : [],
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const tallaMap = new Map(tallas.map((t) => [t.id, t.numero]));

    return devoluciones.map((d) => ({
      ...d,
      numeroCodigo: d.numero ? `DEV-${String(d.numero).padStart(4, '0')}` : `DEV-${d.id.slice(0, 4).toUpperCase()}`,
      totalDevuelto: Number(d.totalDevuelto),
      deudaDescontada: Number(d.deudaDescontada),
      saldoAFavor: Number(d.saldoAFavor),
      totalPares: d.lines.reduce((sum, l) => sum + l.cantidad, 0),
      lines: d.lines.map((l) => {
        const prod = productMap.get(l.productId);
        const numTalla = tallaMap.get(l.tallaId);
        return {
          ...l,
          cantidad: l.cantidad,
          precioCosto: Number(l.precioCosto),
          subtotal: Number(l.subtotal),
          numeroTalla: numTalla ?? 38,
          modelName: prod?.model?.name || 'Calzado Devuelto',
          brand: prod?.model?.brand || '',
          color: prod?.color || '',
          imageUrl: prod?.imageUrl || null,
        };
      }),
    }));
  }

  /**
   * Recibir pago de excedente del proveedor (en efectivo).
   */
  async recibirPagoExcedenteProveedor(
    devolucionId: string,
    tenantId: string,
    userId?: string,
    metodo?: string,
  ) {
    const devolucion = await this.prisma.proveedorDevolucion.findFirst({
      where: { id: devolucionId, tenantId },
    });

    if (!devolucion) {
      throw new NotFoundException('Devolucion a proveedor no encontrada.');
    }

    if (devolucion.saldoAFavorPagado) {
      throw new BadRequestException('El excedente de esta devolucion ya fue pagado o aplicado.');
    }

    const saldoAFavor = Number(devolucion.saldoAFavor);
    if (saldoAFavor <= 0) {
      throw new BadRequestException('Esta devolucion no tiene saldo a favor.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.proveedorDevolucion.update({
        where: { id: devolucionId },
        data: { saldoAFavorPagado: true },
      });

      const proveedor = await tx.supplier.findUnique({ where: { id: devolucion.supplierId } });
      if (proveedor) {
        const nuevoSaldo = Math.max(0, Number(proveedor.saldoAFavorNegocio) - saldoAFavor);
        await tx.supplier.update({
          where: { id: devolucion.supplierId },
          data: { saldoAFavorNegocio: nuevoSaldo },
        });
      }

      await tx.movimientoFinanciero.create({
        data: {
          tenantId,
          tipo: 'PAGO_EXCEDENTE_PROVEEDOR',
          referenciaId: devolucionId,
          referenciaTabla: 'ProveedorDevolucion',
          supplierId: devolucion.supplierId,
          monto: saldoAFavor,
          descripcion: `Pago del proveedor en ${metodo || 'efectivo'} de $${saldoAFavor.toFixed(2)} por excedente de devolucion`,
          userId: userId || null,
        },
      });

      return { success: true, montoRecibido: saldoAFavor, metodo: metodo || 'EFECTIVO' };
    });
  }

  /**
   * Aplicar saldo a favor del negocio en una deuda de proveedor ("hacer paso").
   */
  async aplicarSaldoFavorProveedor(
    dto: {
      supplierId: string;
      deudaId: string;
      montoAplicar?: number;
    },
    tenantId: string,
    userId?: string,
  ) {
    const proveedor = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    });

    if (!proveedor || Number(proveedor.saldoAFavorNegocio) <= 0) {
      throw new BadRequestException('No hay saldo a favor disponible con este proveedor.');
    }

    const deuda = await this.prisma.deudaProveedor.findFirst({
      where: { id: dto.deudaId, tenantId },
    });

    if (!deuda || Number(deuda.saldoPendiente) <= 0) {
      throw new BadRequestException('La deuda no tiene saldo pendiente.');
    }

    const saldoDisponible = Number(proveedor.saldoAFavorNegocio);
    const saldoPendienteDeuda = Number(deuda.saldoPendiente);
    const montoAplicar = dto.montoAplicar
      ? Math.min(dto.montoAplicar, saldoDisponible, saldoPendienteDeuda)
      : Math.min(saldoDisponible, saldoPendienteDeuda);

    if (montoAplicar <= 0) {
      throw new BadRequestException('El monto a aplicar debe ser mayor a cero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const nuevoSaldoDeuda = saldoPendienteDeuda - montoAplicar;
      const nuevoEstadoDeuda = nuevoSaldoDeuda === 0 ? 'SALDADO' : deuda.estado === 'PENDIENTE' ? 'PARCIALMENTE_PAGADO' : deuda.estado;

      await tx.deudaProveedor.update({
        where: { id: dto.deudaId },
        data: {
          saldoPendiente: nuevoSaldoDeuda,
          estado: nuevoEstadoDeuda,
        },
      });

      const nuevoSaldoProveedor = Math.max(0, saldoDisponible - montoAplicar);
      await tx.supplier.update({
        where: { id: dto.supplierId },
        data: { saldoAFavorNegocio: nuevoSaldoProveedor },
      });

      if (nuevoSaldoProveedor === 0) {
        await tx.proveedorDevolucion.updateMany({
          where: { supplierId: dto.supplierId, tenantId, saldoAFavorPagado: false, saldoAFavor: { gt: 0 } },
          data: { saldoAFavorPagado: true },
        });
      }

      await tx.movimientoFinanciero.create({
        data: {
          tenantId,
          tipo: 'PASO_MERCADERIA_PROVEEDOR',
          referenciaId: dto.deudaId,
          referenciaTabla: 'DeudaProveedor',
          supplierId: dto.supplierId,
          monto: montoAplicar,
          descripcion: `Hacer paso: $${montoAplicar.toFixed(2)} del saldo a favor aplicado a deuda con proveedor (saldo restante: $${nuevoSaldoProveedor.toFixed(2)})`,
          userId: userId || null,
        },
      });

      return {
        success: true,
        montoAplicado: montoAplicar,
        saldoRestanteNegocio: nuevoSaldoProveedor,
        saldoRestanteDeuda: nuevoSaldoDeuda,
      };
    });
  }
}
