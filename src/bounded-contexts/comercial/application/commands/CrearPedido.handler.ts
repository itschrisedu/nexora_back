import { Inject, Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { IPedidoRepository } from '../../domain/IPedidoRepository';
import { IOrderQueueRepository } from '../../domain/IOrderQueueRepository';
import { Pedido } from '../../domain/Pedido';
import { LineaPedido } from '../../domain/LineaPedido';
import { CanalEntrada } from '../../domain/value-objects/CanalEntrada';
import { TipoPago } from '../../domain/value-objects/TipoPago';
import { TipoVenta } from '../../domain/value-objects/TipoVenta';
import { CrearPedidoCommand } from './CrearPedido.command';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { ReservarStockHandler } from '../../../inventario/application/commands/ReservarStock.handler';
import { ReservarStockCommand } from '../../../inventario/application/commands/ReservarStock.command';
import { ComprometerCreditoHandler } from '../../../clientes/application/commands/ComprometerCredito.handler';
import { ComprometerCreditoCommand } from '../../../clientes/application/commands/ComprometerCredito.command';
import { ClientesQueryService } from '../../../clientes/application/queries/ClientesQueryService';
import { Money } from '../../../../shared/domain/Money';
import { EstadoPedido as PrismaEstadoPedido } from '@prisma/client';

@Injectable()
export class CrearPedidoHandler {
  private readonly logger = new Logger(CrearPedidoHandler.name);

  constructor(
    @Inject('IPedidoRepository')
    private readonly pedidoRepository: IPedidoRepository,
    @Inject('IOrderQueueRepository')
    private readonly queueRepository: IOrderQueueRepository,
    private readonly prisma: PrismaService,
    private readonly reservarStockHandler: ReservarStockHandler,
    private readonly comprometerCreditoHandler: ComprometerCreditoHandler,
    private readonly clientesQueryService: ClientesQueryService,
  ) {}

  async execute(command: CrearPedidoCommand): Promise<string> {
    // 1. Obtener datos de productos y validar existencias
    const lineasProducto: {
      productId: string;
      tallaId: string;
      tallaNumero?: number;
      serieId: string;
      cantidad: number;
      precioUnitario: Money;
      tipoVenta: TipoVenta;
      stockDisponible: number;
    }[] = [];

    let totalAcumulado = 0;
    let tieneStockParaTodo = true;

    for (const lineaInput of command.lineas) {
      const prod = await this.prisma.product.findUnique({
        where: { id: lineaInput.productId },
        include: {
          stockByTalla: { include: { talla: true } },
          serie: { include: { tallas: true } },
        },
      });

      if (!prod) {
        throw new NotFoundException(`El producto con ID "${lineaInput.productId}" no existe`);
      }

      // Resolver la talla de forma inteligente y robusta (por ID directo, por número, o por serie/global)
      let stockTalla = prod.stockByTalla.find((s) => s.tallaId === lineaInput.tallaId);
      let resolvedTallaId = lineaInput.tallaId;

      if (!stockTalla) {
        // Intentar buscar por coincidencia de número (ej: "t-38", "38", "t-esp-38")
        const numExtracted = parseInt(String(lineaInput.tallaId).replace(/\D/g, ''), 10);

        if (!isNaN(numExtracted)) {
          stockTalla = prod.stockByTalla.find((s) => s.talla?.numero === numExtracted);
        }

        if (stockTalla) {
          resolvedTallaId = stockTalla.tallaId;
        } else {
          // Si no está en stockByTalla, buscar la TallaConfig en la serie del producto o globalmente
          let tallaConfigMatch: { id: string; numero: number; serieId: string } | null | undefined =
            prod.serie?.tallas?.find(
              (t) => t.id === lineaInput.tallaId || (!isNaN(numExtracted) && t.numero === numExtracted),
            );

          if (!tallaConfigMatch && !isNaN(numExtracted)) {
            tallaConfigMatch = await this.prisma.tallaConfig.findFirst({
              where: { numero: numExtracted },
            });
          }

          if (tallaConfigMatch) {
            resolvedTallaId = tallaConfigMatch.id;
            // Crear la relación en stockByTalla con stock 0 para este producto si aún no existe
            stockTalla = await this.prisma.stockByTalla.upsert({
              where: {
                productId_tallaId: {
                  productId: prod.id,
                  tallaId: tallaConfigMatch.id,
                },
              },
              create: {
                productId: prod.id,
                tallaId: tallaConfigMatch.id,
                quantity: 0,
                reservedQuantity: 0,
                minStock: 0,
              },
              update: {},
              include: { talla: true },
            });
          }
        }
      }

      if (!stockTalla) {
        throw new BadRequestException(
          `La talla con ID "${lineaInput.tallaId}" no está configurada para el producto "${prod.code}"`,
        );
      }

      const disponible = stockTalla.quantity - stockTalla.reservedQuantity;
      if (disponible < lineaInput.cantidad) {
        tieneStockParaTodo = false;
      }

      const precioUnit = (lineaInput.precioUnitario !== undefined && lineaInput.precioUnitario !== null && Number(lineaInput.precioUnitario) > 0)
        ? Money.create(Number(lineaInput.precioUnitario))
        : Money.create(Number(prod.salePrice));
      totalAcumulado += precioUnit.amount * lineaInput.cantidad;

      lineasProducto.push({
        productId: lineaInput.productId,
        tallaId: resolvedTallaId,
        tallaNumero: stockTalla?.talla?.numero,
        serieId: prod.serieId,
        cantidad: lineaInput.cantidad,
        precioUnitario: precioUnit,
        tipoVenta: TipoVenta.create(lineaInput.tipoVenta),
        stockDisponible: disponible,
      });
    }

    // 2. Validar capacidad crediticia si el pago es a CRÉDITO
    if (command.tipoPago === 'CREDITO') {
      const scoring = await this.clientesQueryService.validarCapacidadCrediticia(
        command.clientId,
        totalAcumulado,
      );

      if (!scoring.aprobado) {
        throw new BadRequestException(
          `Venta a crédito rechazada para el cliente. Razón: ${scoring.razon}`,
        );
      }
    }

    // 3. Determinar estado inicial y realizar reservas si hay stock suficiente
    const estadoInicial = tieneStockParaTodo
      ? PrismaEstadoPedido.PENDIENTE
      : PrismaEstadoPedido.EN_ESPERA_STOCK;

    const pedidoId = crypto.randomUUID();

    // Reconstruir entidades de LineaPedido
    const domainLineas = lineasProducto.map((line) =>
      LineaPedido.crear(
        crypto.randomUUID(),
        line.productId,
        line.serieId,
        line.tallaId,
        line.cantidad,
        line.precioUnitario,
        line.tipoVenta,
      ),
    );

    // Si hay stock disponible de todo, reservar físicamente en inventario (TTL 24 horas)
    if (estadoInicial === PrismaEstadoPedido.PENDIENTE) {
      for (const line of domainLineas) {
        await this.reservarStockHandler.execute(
          new ReservarStockCommand(
            line.productId,
            line.tallaId,
            line.cantidad,
            'RESERVA_PEDIDO_AUTOMATICA',
            pedidoId,
            1440, // 24 horas (TTL)
          ),
        );
      }
    }

    // 4. Comprometer el crédito del cliente si es crédito aprobado
    if (command.tipoPago === 'CREDITO' && estadoInicial === PrismaEstadoPedido.PENDIENTE) {
      await this.comprometerCreditoHandler.execute(
        new ComprometerCreditoCommand(command.clientId, totalAcumulado),
      );
    }

    // 5. Crear el pedido agregador
    const pedido = Pedido.crear(
      pedidoId,
      command.clientId,
      CanalEntrada.create(command.canal),
      TipoPago.create(command.tipoPago),
      domainLineas,
      estadoInicial,
      command.userId,
    );

    // Resolver sucursal efectiva si viene vacía (ej. Admin General)
    let effectiveTenantId: string | undefined = command.tenantId || undefined;
    if (!effectiveTenantId) {
      const activeTenant = await this.prisma.tenant.findFirst({
        where: { active: true },
        orderBy: { createdAt: 'asc' },
      });
      effectiveTenantId = activeTenant?.id;
    }

    // Persistir el pedido
    await this.pedidoRepository.save(pedido, effectiveTenantId);

    // Actualizar campos de logística de entrega (Fase E1)
    await this.prisma.order.update({
      where: { id: pedidoId },
      data: {
        tipoEntrega: command.tipoEntrega || 'PRESENCIAL',
        asumeFlete: command.asumeFlete || 'NO_APLICA',
        costoEnvio: command.costoEnvio || 0,
        guiaEnvio: command.guiaEnvio || null,
        courier: command.courier || null,
        direccionEnvio: command.direccionEnvio || null,
        ciudadEnvio: command.ciudadEnvio || null,
        adelanto: command.adelanto || 0,
        metodoAdelanto: command.metodoAdelanto || null,
        referenciaAdelanto: command.referenciaAdelanto || null,
      },
    });

    // Si la empresa cubre el flete y tiene costo > 0, registrar automáticamente el gasto operativo de envío
    if (command.asumeFlete === 'EMPRESA' && command.costoEnvio && Number(command.costoEnvio) > 0) {
      await this.prisma.gasto.create({
        data: {
          tenantId: effectiveTenantId!,
          userId: command.userId,
          orderId: pedidoId,
          categoria: 'LOGISTICA_ENVIOS',
          concepto: `Flete de envío pedido #${pedidoId.slice(0, 8)} (${command.courier || 'Transporte'})`,
          monto: command.costoEnvio,
          metodoPago: 'EFECTIVO',
          numeroComprobante: command.guiaEnvio || null,
          proveedorServicio: command.courier || 'Empresa de Envíos',
          observaciones: `Envío a ${command.ciudadEnvio || ''} - ${command.direccionEnvio || ''}`.trim(),
        },
      });
    }

    // 6. Si falta stock, registrar en la cola de prioridad y enviar solicitud al proveedor si está vinculado
    if (estadoInicial === PrismaEstadoPedido.EN_ESPERA_STOCK) {
      const cli = await this.clientesQueryService.obtenerCliente(command.clientId);
      await this.queueRepository.save({
        orderId: pedidoId,
        clientId: command.clientId,
        prioridadFifo: pedido.createdAt,
        nivelCredito: cli.nivelCredito,
        totalHistorico: cli.totalCompras * 50,
        activa: true,
      });

      // Generar o acumular orden de compra automática al proveedor en estado BORRADOR
      try {
        interface FaltanteData {
          totalFaltante: number;
          desgloseTallas: { tallaNumero?: number; faltante: number }[];
        }

        // 1. Agrupar faltantes por producto registrando el total y desglose por tallas
        const faltantesPorProducto = new Map<string, FaltanteData>();
        for (const line of lineasProducto) {
          if (line.stockDisponible < line.cantidad) {
            const faltante = line.cantidad - line.stockDisponible;
            const actual = faltantesPorProducto.get(line.productId) || { totalFaltante: 0, desgloseTallas: [] };
            actual.totalFaltante += faltante;
            actual.desgloseTallas.push({
              tallaNumero: line.tallaNumero,
              faltante,
            });
            faltantesPorProducto.set(line.productId, actual);
          }
        }

        const nombreCliente = [cli?.nombre, cli?.apellido].filter(Boolean).join(' ').trim() || 'Cliente';
        const refPedido = pedido.id.substring(0, 8).toUpperCase();

        const supplierGroups = new Map<string, {
          productId: string;
          cantidad: number;
          precioCosto: number;
          observacion: string;
          detallePedido: string;
        }[]>();

        // 2. Por cada producto con déficit, calcular: totalFaltante + 1 docena extra (12 pares) para abastecer el pedido y stock
        for (const [prodId, info] of faltantesPorProducto.entries()) {
          const cantidadAComprar = info.totalFaltante + 12;

          const prodWithModel = await this.prisma.product.findUnique({
            where: { id: prodId },
            include: { model: true },
          });

          // Obtener el proveedor vinculado: producto → modelo → proveedor del tenant / organización
          let supplierId = prodWithModel?.supplierId || prodWithModel?.model?.supplierId;
          if (!supplierId) {
            let defaultSupplier = await this.prisma.supplier.findFirst({
              where: { activo: true, tenantId: effectiveTenantId },
              orderBy: { createdAt: 'asc' },
            });
            if (!defaultSupplier) {
              defaultSupplier = await this.prisma.supplier.findFirst({
                where: { activo: true },
                orderBy: { createdAt: 'asc' },
              });
            }
            if (!defaultSupplier) {
              const defaultTenantId = effectiveTenantId || (await this.prisma.tenant.findFirst({ where: { active: true } }))?.id;
              if (defaultTenantId) {
                const randomSuffix = Math.floor(1000 + Math.random() * 9000);
                defaultSupplier = await this.prisma.supplier.create({
                  data: {
                    tenantId: defaultTenantId,
                    razonSocial: 'Taller / Fábrica de Calzado Principal',
                    ruc: `189000${randomSuffix}001`,
                    contacto: 'Taller de Producción',
                    activo: true,
                  },
                });
              }
            }
            supplierId = defaultSupplier?.id;
          }

          if (supplierId) {
            const tallasStr = info.desgloseTallas
              .map((t) => `T${t.tallaNumero || '?'}: ${t.faltante}p`)
              .join(', ');
            const detallePedido = `Pedido #${refPedido} (${nombreCliente}) - Faltan: ${tallasStr} (${info.totalFaltante} pares) + 12 extra de stock`;

            const lineasConObs = command.lineas.filter((l) => l.productId === prodId && l.observacion?.trim());
            const obsConTallas = lineasConObs
              .map((l) => {
                const prodTalla = lineasProducto.find((lp) => lp.productId === prodId && lp.tallaId === l.tallaId);
                const tallaNum = prodTalla?.tallaNumero || (l as any).tallaNumero;
                const tallaStr = tallaNum ? `[T${tallaNum}]: ` : '';
                return `${tallaStr}${l.observacion?.trim()}`;
              })
              .join(' • ');

            const obsFinalLinea = obsConTallas ? `${detallePedido} | Nota: ${obsConTallas}` : detallePedido;

            if (!supplierGroups.has(supplierId)) supplierGroups.set(supplierId, []);
            supplierGroups.get(supplierId)!.push({
              productId: prodId,
              cantidad: cantidadAComprar,
              precioCosto: Number(prodWithModel?.costPrice || 10),
              observacion: obsFinalLinea,
              detallePedido,
            });
          } else {
            this.logger.warn(`No se encontró ningún proveedor activo en el sistema para el producto ${prodId}.`);
          }
        }

        const ordenesGeneradasIds: string[] = [];

        for (const [supId, items] of supplierGroups.entries()) {
          // Buscar si ya existe una orden de compra pendiente en estado BORRADOR para este proveedor
          let ordenCompra = await this.prisma.supplierOrder.findFirst({
            where: {
              supplierId: supId,
              estado: 'BORRADOR',
            },
            orderBy: { createdAt: 'desc' },
            include: { lines: true },
          });

          // Si la orden borrador fue fijada o ajustada manualmente por el comerciante, NO alterarla ni inyectarle más pares
          if (ordenCompra && ordenCompra.observaciones && ordenCompra.observaciones.includes('[AJUSTE_MANUAL]')) {
            ordenCompra = null;
          }

          const detallePedidosItems = items.map((i) => i.detallePedido).join('; ');

          if (!ordenCompra) {
            const obsInicial = `Generada automáticamente por pedidos sin stock: [${detallePedidosItems}]${command.notas?.trim() ? ` | Notas pedido: ${command.notas.trim()}` : ''}`;
            ordenCompra = await this.prisma.supplierOrder.create({
              data: {
                supplierId: supId,
                total: 0,
                estado: 'BORRADOR',
                observaciones: obsInicial,
              },
              include: { lines: true },
            });
          } else {
            // Anexar la referencia de este pedido a las observaciones de la orden existente
            const yaContienePedido = ordenCompra.observaciones?.includes(`#${refPedido}`);
            if (!yaContienePedido) {
              const nuevaObs = ordenCompra.observaciones
                ? `${ordenCompra.observaciones}\n+ Anexo pedido sin stock: [${detallePedidosItems}]`
                : `Generada automáticamente por pedidos sin stock: [${detallePedidosItems}]`;
              await this.prisma.supplierOrder.update({
                where: { id: ordenCompra.id },
                data: { observaciones: nuevaObs },
              });
            }
          }

          ordenesGeneradasIds.push(`OC-${ordenCompra.numero || ordenCompra.id.substring(0, 8)}`);

          // Anexar o acumular líneas en la orden
          for (const item of items) {
            const existingLine = ordenCompra.lines.find((l) => l.productId === item.productId);
            if (existingLine) {
              const nuevaCant = existingLine.cantidadPedida + item.cantidad;
              const obsActual = existingLine.observacionLinea ? `${existingLine.observacionLinea} | ` : '';
              await this.prisma.supplierOrderLine.update({
                where: { id: existingLine.id },
                data: {
                  cantidadPedida: nuevaCant,
                  subtotal: nuevaCant * item.precioCosto,
                  observacionLinea: `${obsActual}+${item.cantidad}p (Pedido #${refPedido})`,
                },
              });
            } else {
              await this.prisma.supplierOrderLine.create({
                data: {
                  supplierOrderId: ordenCompra.id,
                  productId: item.productId,
                  cantidadPedida: item.cantidad,
                  precioCosto: item.precioCosto,
                  subtotal: item.cantidad * item.precioCosto,
                  observacionLinea: item.observacion,
                },
              });
            }
          }

          // Recalcular total acumulado de la orden
          const allLines = await this.prisma.supplierOrderLine.findMany({
            where: { supplierOrderId: ordenCompra.id },
          });
          const totalRecalculado = allLines.reduce((acc, l) => acc + Number(l.subtotal), 0);
          await this.prisma.supplierOrder.update({
            where: { id: ordenCompra.id },
            data: { total: totalRecalculado },
          });
        }

        // 3. Vincular visualmente la orden de compra generada en las notas del pedido de venta
        if (ordenesGeneradasIds.length > 0) {
          const tagOC = `[Orden de Compra generada: ${ordenesGeneradasIds.join(', ')}]`;
          const currentOrder = await this.prisma.order.findUnique({ where: { id: pedidoId } });
          const notasActualizadas = currentOrder?.notas
            ? `${currentOrder.notas} | ${tagOC}`
            : tagOC;
          await this.prisma.order.update({
            where: { id: pedidoId },
            data: { notas: notasActualizadas },
          });
        }
      } catch (e: any) {
        this.logger.error(`Error al generar orden automática a proveedor: ${e?.message || e}`, e?.stack);
        try {
          const currentOrder = await this.prisma.order.findUnique({ where: { id: pedidoId } });
          const errorTag = `[Aviso: Falla al generar OC automática: ${e?.message || 'Error'}]`;
          await this.prisma.order.update({
            where: { id: pedidoId },
            data: { notas: currentOrder?.notas ? `${currentOrder.notas} | ${errorTag}` : errorTag },
          });
        } catch {}
      }
    }

    return pedido.id;
  }
}
