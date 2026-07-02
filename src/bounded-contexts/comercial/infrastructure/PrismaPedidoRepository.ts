import { Injectable, Logger } from '@nestjs/common';
import { IPedidoRepository, PedidoFilters } from '../domain/IPedidoRepository';
import { Pedido } from '../domain/Pedido';
import { LineaPedido } from '../domain/LineaPedido';
import { EstadoPedido } from '../domain/value-objects/EstadoPedido';
import { CanalEntrada } from '../domain/value-objects/CanalEntrada';
import { TipoPago } from '../domain/value-objects/TipoPago';
import { TipoVenta } from '../domain/value-objects/TipoVenta';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { Money } from '../../../shared/domain/Money';

@Injectable()
export class PrismaPedidoRepository extends IPedidoRepository {
  private readonly logger = new Logger(PrismaPedidoRepository.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<Pedido | null> {
    const record = await this.prisma.order.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async findAll(filters?: PedidoFilters): Promise<Pedido[]> {
    const where: any = {};

    if (filters?.clientId) {
      where.clientId = filters.clientId;
    }

    if (filters?.estado) {
      where.estado = filters.estado;
    }

    if (filters?.userId) {
      where.userId = filters.userId;
    }

    const records = await this.prisma.order.findMany({
      where,
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((r) => this.toDomain(r));
  }

  async save(pedido: Pedido): Promise<void> {
    const linesData = pedido.lineas.map((line) => ({
      id: line.id,
      productId: line.productId,
      serieId: line.serieId,
      tallaId: line.tallaId,
      cantidad: line.cantidad,
      precioUnitario: line.precioUnitario.amount,
      tipoVenta: line.tipoVenta.value,
    }));

    await this.prisma.order.create({
      data: {
        id: pedido.id,
        clientId: pedido.clientId,
        estado: pedido.estado.value,
        canal: pedido.canal.value,
        tipoPago: pedido.tipoPago.value,
        montoTotal: pedido.montoTotal.amount,
        userId: pedido.userId,
        createdAt: pedido.createdAt,
        lines: {
          createMany: { data: linesData },
        },
      },
    });

    this.logger.log(`Pedido guardado: ${pedido.id}`);
  }

  async update(pedido: Pedido): Promise<void> {
    await this.prisma.order.update({
      where: { id: pedido.id },
      data: {
        estado: pedido.estado.value,
        montoTotal: pedido.montoTotal.amount,
      },
    });

    this.logger.log(`Pedido actualizado: ${pedido.id}`);
  }

  // ── Mapeador Prisma → Domain ──────────────────

  private toDomain(record: any): Pedido {
    const domainLines = record.lines.map((l: any) =>
      LineaPedido.reconstruir(l.id, {
        productId: l.productId,
        serieId: l.serieId,
        tallaId: l.tallaId,
        cantidad: l.cantidad,
        precioUnitario: Money.create(Number(l.precioUnitario)),
        tipoVenta: TipoVenta.create(l.tipoVenta),
      }),
    );

    return Pedido.reconstruir(
      record.id,
      record.clientId,
      EstadoPedido.create(record.estado),
      CanalEntrada.create(record.canal),
      TipoPago.create(record.tipoPago),
      domainLines,
      Money.create(Number(record.montoTotal)),
      record.userId,
      record.createdAt,
    );
  }
}
