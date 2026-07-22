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
   * 1. Reingresa el stock al inventario por producto y talla.
   * 2. Ajusta el saldo pendiente del Cobro / Nota de Venta asociada.
   * 3. Registra el historial de ClienteDevolucion.
   */
  async registrarDevolucionCliente(
    dto: {
      saleNoteId?: string;
      orderId?: string;
      clientId: string;
      motivo: string;
      lines: LineaDevolucionClienteInput[];
    },
    tenantId: string,
  ) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Debes incluir al menos una línea de producto a devolver.');
    }

    const totalDevuelto = dto.lines.reduce(
      (acc, l) => acc + l.cantidad * l.precioUnitario,
      0,
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Reingresar stock por cada línea
      for (const line of dto.lines) {
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

      // 2. Ajustar Cobro si existe venta asociada
      if (dto.saleNoteId) {
        const cobro = await tx.cobro.findUnique({
          where: { saleNoteId: dto.saleNoteId },
        });

        if (cobro) {
          const nuevoSaldo = Math.max(0, Number(cobro.saldoPendiente) - totalDevuelto);
          const nuevoMonto = Math.max(0, Number(cobro.montoTotal) - totalDevuelto);
          const nuevoEstado = nuevoSaldo === 0 ? 'SALDADO' : cobro.estado;

          await tx.cobro.update({
            where: { id: cobro.id },
            data: {
              saldoPendiente: nuevoSaldo,
              montoTotal: nuevoMonto,
              estado: nuevoEstado,
            },
          });
        }
      }

      // 3. Crear registro de devolución
      const devolucion = await tx.clienteDevolucion.create({
        data: {
          tenantId,
          saleNoteId: dto.saleNoteId,
          orderId: dto.orderId,
          clientId: dto.clientId,
          motivo: dto.motivo,
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
