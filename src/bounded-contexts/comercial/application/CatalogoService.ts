import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../shared/infrastructure/encryption/encryption.service';
import { CanalEntrada, EstadoPedido, TipoPago, TipoVenta } from '@prisma/client';

export interface RegistrarPedidoWhatsAppDto {
  tenantId?: string;
  cliente: {
    nombre: string;
    apellido?: string;
    identificacion: string;
    telefono: string;
    direccion?: string;
    email?: string;
  };
  lineas: {
    productId: string;
    serieId: string;
    tallaId: string;
    cantidad: number;
    precioUnitario: number;
    tipoVenta?: TipoVenta;
  }[];
  notas?: string;
}

@Injectable()
export class CatalogoService {
  private readonly logger = new Logger(CatalogoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Obtiene la información pública de la tienda (Razón social, teléfono WhatsApp, dirección, logo).
   */
  async obtenerInfoTienda(tenantIdParam?: string) {
    const tenant = await this.resolveTenant(tenantIdParam);
    const config = await this.prisma.businessConfig.findUnique({
      where: { tenantId: tenant.id },
    });

    return {
      tenantId: tenant.id,
      nombreNegocio: config?.nombre || tenant.name,
      direccion: config?.direccion || 'Ecuador',
      telefono: config?.telefono || '',
      email: config?.email || '',
      logoUrl: config?.logoUrl || null,
      ruc: config ? this.encryption.decrypt(config.ruc) : '',
    };
  }

  /**
   * Obtiene los modelos de calzado activos con sus productos, series, tallas y stock disponible.
   */
  async obtenerCatalogoPublico(tenantIdParam?: string) {
    const tenant = await this.resolveTenant(tenantIdParam);

    const modelos = await this.prisma.productModel.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
      },
      include: {
        products: {
          where: { active: true },
          include: {
            serie: true,
            stockByTalla: {
              include: {
                talla: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Formatear para consumo limpio del frontend del catálogo público
    return modelos.map((m) => ({
      id: m.id,
      baseCode: m.baseCode,
      name: m.name,
      brand: m.brand,
      material: m.material,
      variantes: m.products.map((p) => ({
        id: p.id,
        code: p.code,
        color: p.color,
        imageUrl: p.imageUrl,
        costPrice: Number(p.costPrice),
        salePrice: Number(p.salePrice),
        serieNombre: p.serie.nombre,
        serieId: p.serie.id,
        tallas: p.stockByTalla.map((st) => ({
          tallaId: st.tallaId,
          numero: st.talla.numero,
          cantidad: st.quantity,
        })),
      })),
    }));
  }

  /**
   * Registra un pedido realizado desde el Catálogo Digital / WhatsApp.
   */
  async registrarPedidoWhatsApp(dto: RegistrarPedidoWhatsAppDto) {
    const tenant = await this.resolveTenant(dto.tenantId);

    // 1. Buscar o crear cliente por teléfono
    let client = await this.prisma.client.findFirst({
      where: {
        tenantId: tenant.id,
        telefono: dto.cliente.telefono,
      },
    });

    if (!client) {
      const encryptedRuc = this.encryption.encrypt(dto.cliente.identificacion);
      client = await this.prisma.client.create({
        data: {
          tenantId: tenant.id,
          nombre: dto.cliente.nombre,
          apellido: dto.cliente.apellido || '',
          ruc: encryptedRuc,
          telefono: dto.cliente.telefono,
          direccion: dto.cliente.direccion || 'Dirección de WhatsApp',
          email: dto.cliente.email || null,
        },
      });
      this.logger.log(`Nuevo cliente creado desde WhatsApp: ${client.nombre}`);
    }

    // 2. Buscar usuario Admin por defecto del tenant para asignar como creador
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'asc' },
    });

    if (!adminUser) {
      throw new NotFoundException('No existe usuario administrador para procesar el pedido.');
    }

    // 3. Calular monto total
    const montoTotal = dto.lineas.reduce(
      (acc, item) => acc + item.cantidad * item.precioUnitario,
      0,
    );

    // 4. Crear el pedido en transacción
    const newOrder = await this.prisma.order.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        userId: adminUser.id,
        estado: EstadoPedido.PENDIENTE,
        canal: CanalEntrada.WHATSAPP,
        tipoPago: TipoPago.CONTADO,
        montoTotal,
        notas: dto.notas || 'Pedido recibido desde Catálogo Digital WhatsApp',
        lines: {
          create: dto.lineas.map((l) => ({
            productId: l.productId,
            serieId: l.serieId,
            tallaId: l.tallaId,
            cantidad: l.cantidad,
            precioUnitario: l.precioUnitario,
            tipoVenta: l.tipoVenta || TipoVenta.TALLA_ESPECIFICA,
          })),
        },
      },
      include: {
        lines: true,
      },
    });

    this.logger.log(`Pedido de WhatsApp registrado exitosamente: ${newOrder.id}`);
    return newOrder;
  }

  /**
   * Resuelve el tenant activo (por id o primer tenant existente)
   */
  private async resolveTenant(tenantIdParam?: string) {
    if (tenantIdParam) {
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantIdParam } });
      if (t) return t;
    }
    const firstTenant = await this.prisma.tenant.findFirst({ where: { active: true } });
    if (!firstTenant) {
      throw new NotFoundException('No existe un Tenant activo configurado.');
    }
    return firstTenant;
  }
}
