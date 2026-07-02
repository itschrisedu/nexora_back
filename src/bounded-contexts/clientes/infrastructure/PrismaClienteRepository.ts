import { Injectable, Logger } from '@nestjs/common';
import { IClienteRepository, ClienteFilters } from '../domain/IClienteRepository';
import { Cliente } from '../domain/Cliente';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { Money } from '../../../shared/domain/Money';
import { NivelCredito } from '../domain/value-objects/NivelCredito';

@Injectable()
export class PrismaClienteRepository extends IClienteRepository {
  private readonly logger = new Logger(PrismaClienteRepository.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<Cliente | null> {
    const record = await this.prisma.client.findUnique({
      where: { id },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async findByTelefono(telefono: string): Promise<Cliente | null> {
    const record = await this.prisma.client.findFirst({
      where: { telefono },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async findAll(filters?: ClienteFilters): Promise<Cliente[]> {
    const where: any = {};

    if (filters?.q) {
      where.OR = [
        { nombre: { contains: filters.q, mode: 'insensitive' } },
        { apellido: { contains: filters.q, mode: 'insensitive' } },
        { telefono: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    if (filters?.nivelCredito) {
      where.nivelCredito = filters.nivelCredito;
    }

    if (filters?.activo !== undefined) {
      where.activo = filters.activo;
    }

    const records = await this.prisma.client.findMany({
      where,
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });

    return records.map((r) => this.toDomain(r));
  }

  async save(cliente: Cliente): Promise<void> {
    await this.prisma.client.create({
      data: {
        id: cliente.id,
        nombre: cliente.nombre,
        apellido: cliente.apellido,
        telefono: cliente.telefono,
        email: cliente.email,
        ruc: cliente.ruc,
        cedula: cliente.cedula,
        direccion: cliente.direccion,
        notas: cliente.notas,
        nivelCredito: cliente.nivelCredito.value,
        totalCompras: cliente.totalCompras,
        comprasSinAtraso: cliente.comprasSinAtraso,
        atrasoConsecutivo: cliente.atrasoConsecutivo,
        limiteCredito: cliente.limiteCredito.amount,
        creditoUtilizado: cliente.creditoUtilizado.amount,
        activo: cliente.activo,
      },
    });

    this.logger.log(`Cliente registrado: ${cliente.nombre} ${cliente.apellido}`);
  }

  async update(cliente: Cliente): Promise<void> {
    await this.prisma.client.update({
      where: { id: cliente.id },
      data: {
        nombre: cliente.nombre,
        apellido: cliente.apellido,
        telefono: cliente.telefono,
        email: cliente.email,
        ruc: cliente.ruc,
        cedula: cliente.cedula,
        direccion: cliente.direccion,
        notas: cliente.notas,
        nivelCredito: cliente.nivelCredito.value,
        totalCompras: cliente.totalCompras,
        comprasSinAtraso: cliente.comprasSinAtraso,
        atrasoConsecutivo: cliente.atrasoConsecutivo,
        limiteCredito: cliente.limiteCredito.amount,
        creditoUtilizado: cliente.creditoUtilizado.amount,
        activo: cliente.activo,
      },
    });

    this.logger.log(`Cliente actualizado: ${cliente.nombre} ${cliente.apellido}`);
  }

  // ── Mapeador Prisma → Domain ──────────────────

  private toDomain(record: any): Cliente {
    return Cliente.reconstruir(
      record.id,
      record.nombre,
      record.apellido,
      record.telefono,
      record.email,
      record.ruc,
      record.cedula,
      record.direccion,
      record.notas,
      NivelCredito.create(record.nivelCredito),
      record.totalCompras,
      record.comprasSinAtraso,
      record.atrasoConsecutivo,
      Money.create(Number(record.limiteCredito)),
      Money.create(Number(record.creditoUtilizado)),
      record.activo,
    );
  }
}
