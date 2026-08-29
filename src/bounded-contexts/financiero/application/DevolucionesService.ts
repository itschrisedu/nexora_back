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
   * Registrar devolución de cliente:
   * 1. Reingresa o Da de Baja el stock según destinoStock ('REINGRESO_INVENTARIO' | 'BAJA_POR_FALLA').
   * 2. Ajusta el saldo pendiente del Cobro / Nota de Venta asociada o cartera del cliente.
   * 3. Registra el historial de ClienteDevolucion.
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
  ) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Debes incluir al menos una línea de producto a devolver.');
    }

    const destinoStock = dto.destinoStock || 'REINGRESO_INVENTARIO';
    const tipoDevolucion = dto.tipoDevolucion || 'TALLA_ESPECIFICA';

    const totalDevuelto = dto.lines.reduce(
      (acc, l) => acc + l.cantidad * l.precioUnitario,
      0,
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Manejo del Stock: Si es REINGRESO_INVENTARIO, se suma a bodega
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

      // 2. Ajustar Cobro de la Nota de Venta o buscar el cobro con saldo del cliente
      let cobroAfectado = null;
      if (dto.saleNoteId) {
        cobroAfectado = await tx.cobro.findUnique({
          where: { saleNoteId: dto.saleNoteId },
        });
      } else {
        cobroAfectado = await tx.cobro.findFirst({
          where: {
            clientId: dto.clientId,
            tenantId,
            saldoPendiente: { gt: 0 },
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (cobroAfectado) {
        const nuevoSaldo = Math.max(0, Number(cobroAfectado.saldoPendiente) - totalDevuelto);
        const nuevoMonto = Math.max(0, Number(cobroAfectado.montoTotal) - totalDevuelto);
        const nuevoEstado = nuevoSaldo === 0 ? 'SALDADO' : cobroAfectado.estado;

        await tx.cobro.update({
          where: { id: cobroAfectado.id },
          data: {
            saldoPendiente: nuevoSaldo,
            montoTotal: nuevoMonto,
            estado: nuevoEstado,
          },
        });
      }

      // 3. Crear registro de devolución con motivo estructurado
      const motivoCompleto = `[${destinoStock === 'BAJA_POR_FALLA' ? 'MERMA/BAJA POR FALLA' : 'REINGRESO A BODEGA'}] [${tipoDevolucion === 'SERIE_COMPLETA' ? 'SERIE COMPLETA' : 'TALLA ESPECÍFICA'}] ${dto.motivo || 'Devolución de cliente'}`;

      const devolucion = await tx.clienteDevolucion.create({
        data: {
          tenantId,
          saleNoteId: dto.saleNoteId || cobroAfectado?.saleNoteId || null,
          orderId: dto.orderId,
          clientId: dto.clientId,
          motivo: motivoCompleto,
          totalDevuelto,
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

      return devolucion;
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
   * Registrar devolución a proveedor (garantía / mercancía defectuosa):
   * 1. Descuenta el stock físico por producto y talla.
   * 2. Ajusta el saldo pendiente de DeudaProveedor.
   * 3. Registra el historial de ProveedorDevolucion.
   */
  async registrarDevolucionProveedor(
    dto: {
      entradaId?: string;
      supplierId: string;
      motivo: string;
      lines: LineaDevolucionProveedorInput[];
    },
    tenantId: string,
  ) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Debes incluir al menos una línea de producto a devolver al proveedor.');
    }

    const totalDevuelto = dto.lines.reduce(
      (acc, l) => acc + l.cantidad * l.precioCosto,
      0,
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Descontar stock por cada línea
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

      // 2. Ajustar DeudaProveedor si existe entrada asociada
      if (dto.entradaId) {
        const deuda = await tx.deudaProveedor.findUnique({
          where: { entradaId: dto.entradaId },
        });

        if (deuda) {
          const nuevoSaldo = Math.max(0, Number(deuda.saldoPendiente) - totalDevuelto);
          const nuevoMonto = Math.max(0, Number(deuda.montoTotal) - totalDevuelto);
          const nuevoEstado = nuevoSaldo === 0 ? 'SALDADO' : deuda.estado;

          await tx.deudaProveedor.update({
            where: { id: deuda.id },
            data: {
              saldoPendiente: nuevoSaldo,
              montoTotal: nuevoMonto,
              estado: nuevoEstado,
            },
          });
        }
      }

      // 3. Crear registro de devolución a proveedor
      const devolucion = await tx.proveedorDevolucion.create({
        data: {
          tenantId,
          entradaId: dto.entradaId,
          supplierId: dto.supplierId,
          motivo: dto.motivo,
          totalDevuelto,
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

      return devolucion;
    });
  }

  /**
   * Listar devoluciones a proveedores por tenant.
   */
  async listarDevolucionesProveedor(tenantId: string) {
    return this.prisma.proveedorDevolucion.findMany({
      where: { tenantId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
