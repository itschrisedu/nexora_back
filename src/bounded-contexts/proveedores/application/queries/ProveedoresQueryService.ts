import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';

@Injectable()
export class ProveedoresQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async obtenerProveedor(id: string) {
    const raw = await this.prisma.supplier.findUnique({
      where: { id },
    });
    if (!raw) {
      throw new NotFoundException(`Proveedor con ID "${id}" no encontrado.`);
    }
    return this.formatSupplier(raw);
  }

  async buscarProveedores(q?: string) {
    const where: any = {};
    const suppliers = await this.prisma.supplier.findMany({
      where,
      orderBy: { razonSocial: 'asc' },
    });

    const formated = suppliers.map((s) => this.formatSupplier(s));
    
    if (q) {
      const normalizedQuery = q.toLowerCase();
      return formated.filter(
        (s) =>
          s.razonSocial.toLowerCase().includes(normalizedQuery) ||
          s.ruc.includes(normalizedQuery) ||
          (s.contacto && s.contacto.toLowerCase().includes(normalizedQuery)),
      );
    }

    return formated;
  }

  async obtenerOrdenCompra(id: string) {
    const order = await this.prisma.supplierOrder.findUnique({
      where: { id },
      include: { lines: true, supplier: true },
    });
    if (!order) {
      throw new NotFoundException(`Orden de compra "${id}" no encontrada.`);
    }
    return {
      ...order,
      supplier: this.formatSupplier(order.supplier),
      total: Number(order.total),
      lines: order.lines.map((l) => ({
        ...l,
        precioCosto: Number(l.precioCosto),
        subtotal: Number(l.subtotal),
      })),
    };
  }

  async listarOrdenesCompra(supplierId?: string) {
    const orders = await this.prisma.supplierOrder.findMany({
      where: supplierId ? { supplierId } : undefined,
      include: { supplier: true },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((o) => ({
      ...o,
      supplier: this.formatSupplier(o.supplier),
      total: Number(o.total),
    }));
  }

  async obtenerEntradaMercancia(id: string) {
    const entry = await this.prisma.merchandiseEntry.findUnique({
      where: { id },
      include: { lines: true, supplier: true },
    });
    if (!entry) {
      throw new NotFoundException(`Entrada de mercancía "${id}" no encontrada.`);
    }
    return {
      ...entry,
      supplier: this.formatSupplier(entry.supplier),
      total: Number(entry.total),
      lines: entry.lines.map((l) => ({
        ...l,
        precioCosto: Number(l.precioCosto),
        subtotal: Number(l.subtotal),
      })),
    };
  }

  async listarEntradasMercancia(supplierId?: string) {
    const entries = await this.prisma.merchandiseEntry.findMany({
      where: supplierId ? { supplierId } : undefined,
      include: { supplier: true },
      orderBy: { fechaIngreso: 'desc' },
    });
    return entries.map((e) => ({
      ...e,
      supplier: this.formatSupplier(e.supplier),
      total: Number(e.total),
    }));
  }

  private formatSupplier(raw: any) {
    let rucDescifrado = raw.ruc;
    try {
      rucDescifrado = this.encryptionService.decrypt(raw.ruc);
    } catch (e) {
      // Si falla, dejamos el valor crudo de fallback
    }
    return {
      id: raw.id,
      ruc: rucDescifrado,
      razonSocial: raw.razonSocial,
      contacto: raw.contacto,
      direccion: raw.direccion,
      email: raw.email,
      activo: raw.activo,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
