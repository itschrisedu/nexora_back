import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { ICobroRepository } from '../../domain/ICobroRepository';
import { Cobro } from '../../domain/Cobro';
import { Money } from '../../../../shared/domain/Money';
import { PdfGeneratorService } from '../pdf/pdf-generator.service';
import { EventBus } from '../../../../shared/infrastructure/event-bus/event-bus.service';
import { NotaVentaGeneradaEvent } from '../../domain/events/FinancieroEvents';

@Injectable()
export class PedidoEntregadoFinancieroListener {
  private readonly logger = new Logger(PedidoEntregadoFinancieroListener.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('ICobroRepository') private readonly cobroRepo: ICobroRepository,
    private readonly pdfService: PdfGeneratorService,
    private readonly eventBus: EventBus,
  ) {}

  @OnEvent('PedidoEntregado')
  async handle(payload: {
    pedidoId: string;
    clientId: string;
    montoFinal: number;
    lineasEntregadas: Array<{
      productId: string;
      tallaId: string;
      cantidad: number;
      precioUnitario: number;
    }>;
    tipoPago: string;
    canal: string;
  }) {
    this.logger.log(`📄 Generando Nota de Venta para pedido: ${payload.pedidoId}`);

    try {
      // 1. Obtener número correlativo de la secuencia PostgreSQL o fallback a máximo
      let numero = 1;
      try {
        const lastNote = await this.prisma.saleNote.findFirst({
          orderBy: { numero: 'desc' },
          select: { numero: true },
        });
        numero = (lastNote?.numero || 0) + 1;
      } catch (seqErr) {
        numero = Math.floor(Date.now() / 1000) % 1000000;
      }

      // 2. Obtener datos del cliente y de la orden para obtener el tenantId
      const [cliente, order] = await Promise.all([
        this.prisma.client.findUnique({
          where: { id: payload.clientId },
        }),
        this.prisma.order.findUnique({
          where: { id: payload.pedidoId },
        }),
      ]);

      if (!order) {
        throw new Error(`Pedido con ID ${payload.pedidoId} no encontrado`);
      }
      const tenantId = order.tenantId;

      // 3. Obtener datos de productos para snapshots de nombre/serie/talla
      const saleNoteId = crypto.randomUUID();
      const lines = await Promise.all(
        payload.lineasEntregadas.map(async (l) => {
          const prod = await this.prisma.product.findUnique({
            where: { id: l.productId },
            include: { serie: true, model: true },
          });
          // TallaConfig tiene campo 'numero' (entero), no 'nombre'
          const tallaConfig = await this.prisma.tallaConfig.findUnique({ where: { id: l.tallaId } });

          return {
            saleNoteId,
            productId: l.productId,
            nombre: prod?.model?.name ?? 'Producto',
            serie: prod?.serie?.nombre ?? '—',
            talla: tallaConfig ? String(tallaConfig.numero) : l.tallaId,
            cantidad: l.cantidad,
            precioUnitario: l.precioUnitario,
            subtotal: l.precioUnitario * l.cantidad,
          };
        }),
      );

      const subtotal = lines.reduce((acc, l) => acc + l.subtotal, 0);
      const total = payload.montoFinal;
      const descuento = Math.max(0, subtotal - total);

      // 4. Generar PDF
      const negocioConfig = await this.prisma.businessConfig.findFirst({ where: { tenantId } });
      const pdfData = {
        numero,
        fecha: new Date(),
        clienteNombre: cliente
          ? `${cliente.nombre} ${cliente.apellido}`
          : 'Cliente',
        negocioNombre: negocioConfig?.nombre ?? 'NEXORA',
        negocioRuc: negocioConfig?.ruc ?? '0000000000001',
        negocioDireccion: negocioConfig?.direccion ?? 'Ecuador',
        negocioTelefono: negocioConfig?.telefono ?? undefined,
        lines: lines.map((l) => ({
          nombre: l.nombre,
          serie: l.serie,
          talla: l.talla,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          subtotal: l.subtotal,
        })),
        subtotal,
        descuento,
        total,
      };

      const pdfPath = await this.pdfService.generarNotaVenta(pdfData);
      const pdfUrl = `/storage/notas-venta/nota-venta-${String(numero).padStart(6, '0')}.pdf`;

      // 5. Persistir SaleNote con líneas
      await this.prisma.saleNote.create({
        data: {
          id: saleNoteId,
          tenantId,
          numero,
          orderId: payload.pedidoId,
          clientId: payload.clientId,
          subtotal,
          descuento,
          total,
          pdfUrl,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              nombre: l.nombre,
              serie: l.serie,
              talla: l.talla,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              subtotal: l.subtotal,
            })),
          },
        },
      });

      // 6. Crear Cobro según tipo de pago
      const cobroId = crypto.randomUUID();
      let cobro: Cobro;

      if (payload.tipoPago === 'CONTADO') {
        cobro = Cobro.crearContado(cobroId, saleNoteId, payload.clientId, Money.create(total));

        let metodoPago = 'EFECTIVO';
        let notasPago = 'Pago de contado al entregar';
        if (order.notas) {
          if (order.notas.includes('TRANSFERENCIA')) metodoPago = 'TRANSFERENCIA';
          else if (order.notas.includes('DEPOSITO')) metodoPago = 'DEPOSITO';
          else if (order.notas.includes('CHEQUE')) metodoPago = 'CHEQUE';
          notasPago = order.notas;
        }

        cobro.registrarAbono(
          crypto.randomUUID(),
          Money.create(total),
          metodoPago,
          order.userId || 'system',
          notasPago,
        );
      } else {
        // CREDITO: plazo de 30 días por defecto (se puede ajustar según nivel del cliente)
        const vencimiento = new Date();
        vencimiento.setDate(vencimiento.getDate() + 30);
        cobro = Cobro.crearCredito(cobroId, saleNoteId, payload.clientId, Money.create(total), vencimiento);
      }

      await this.cobroRepo.save(cobro, tenantId);

      // 7. Emitir NotaVentaGenerada
      this.eventBus.publish(
        new NotaVentaGeneradaEvent(saleNoteId, numero, payload.clientId, pdfUrl, cobroId, total),
      );

      // 8. Publicar eventos internos del Cobro (CobroCreado + DeudaSaldada si contado)
      this.eventBus.publishAll(cobro.clearDomainEvents());

      this.logger.log(`✅ Nota de Venta N°${numero} generada. Cobro: ${cobroId}`);
    } catch (error: any) {
      this.logger.error(`❌ Error generando Nota de Venta para pedido ${payload.pedidoId}: ${error.message}`);
    }
  }
}
