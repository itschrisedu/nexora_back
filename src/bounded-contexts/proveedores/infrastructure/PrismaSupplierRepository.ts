import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { ISupplierRepository } from '../domain/ISupplierRepository';
import { Supplier } from '../domain/Supplier';

@Injectable()
export class PrismaSupplierRepository extends ISupplierRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<Supplier | null> {
    const raw = await this.prisma.supplier.findUnique({
      where: { id },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async findByRuc(ruc: string): Promise<Supplier | null> {
    // ruc en la base de datos está cifrado, por lo que el command handler
    // consultará pasándole el RUC ya cifrado para buscar coincidencia exacta.
    const raw = await this.prisma.supplier.findUnique({
      where: { ruc },
    });
    if (!raw) return null;
    return this.toDomain(raw);
  }

  async save(supplier: Supplier): Promise<void> {
    await this.prisma.supplier.create({
      data: {
        id: supplier.id,
        ruc: supplier.ruc,
        razonSocial: supplier.razonSocial,
        contacto: supplier.contacto,
        direccion: supplier.direccion,
        email: supplier.email,
        activo: supplier.activo,
      },
    });
  }

  async update(supplier: Supplier): Promise<void> {
    await this.prisma.supplier.update({
      where: { id: supplier.id },
      data: {
        razonSocial: supplier.razonSocial,
        contacto: supplier.contacto,
        direccion: supplier.direccion,
        email: supplier.email,
        activo: supplier.activo,
      },
    });
  }

  async listAll(): Promise<Supplier[]> {
    const raws = await this.prisma.supplier.findMany({
      orderBy: { razonSocial: 'asc' },
    });
    return raws.map((r) => this.toDomain(r));
  }

  private toDomain(raw: any): Supplier {
    return Supplier.reconstruir(
      raw.id,
      raw.ruc,
      raw.razonSocial,
      raw.contacto,
      raw.direccion,
      raw.email,
      raw.activo,
      raw.createdAt,
    );
  }
}
