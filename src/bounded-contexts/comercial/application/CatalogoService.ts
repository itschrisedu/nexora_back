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
   * Obtiene la información pública de la tienda (Razón social, teléfono WhatsApp, dirección, logo, redes).
   */
  async obtenerInfoTienda(tenantIdParam?: string) {
    const tenant = await this.resolveTenant(tenantIdParam);
    const config = await this.prisma.businessConfig.findUnique({
      where: { tenantId: tenant.id },
    });

    return {
      tenantId: tenant.id,
      nombreNegocio: config?.nombre || tenant.name,
      direccion: config?.direccion || 'Cantón Cevallos, Tungurahua',
      telefono: config?.telefono || '',
      email: config?.email || '',
      logoUrl: config?.logoUrl || null,
      primaryColor: config?.primaryColor || '#0F172A',
      ruc: config ? this.encryption.decrypt(config.ruc) : '',
      heroTitulo: config?.heroTitulo || 'Calzado Ecuatoriano 100% Cuero de Cevallos',
      heroSubtitulo: config?.heroSubtitulo || 'Venta al por mayor y menor directamente desde fábrica con los mejores estándares de calidad y durabilidad.',
      heroBannerUrl: config?.heroBannerUrl || null,
      sobreNosotros: config?.sobreNosotros || 'Somos productores y comercializadores de calzado de cuero en el cantón Cevallos, Tungurahua. Garantizamos calidad de exportación, acabados finos y precios directos de fabricante.',
      whatsappContacto: config?.whatsappContacto || config?.telefono || '593999999999',
      facebookUrl: config?.facebookUrl || null,
      instagramUrl: config?.instagramUrl || null,
      tiktokUrl: config?.tiktokUrl || null,
      mostrarPreciosPublico: config?.mostrarPreciosPublico ?? true,
      mostrarStockPublico: config?.mostrarStockPublico ?? true,
    };
  }

  /**
   * Obtiene los datos completos de la Landing Page pública incluyendo sucursales activas y catálogo de modelos con variantes.
   */
  async obtenerLandingPublica(tenantIdParam?: string) {
    const tenant = await this.resolveTenant(tenantIdParam);
    const infoTienda = await this.obtenerInfoTienda(tenant.id);

    const mainTenant = await this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      include: { businessConfig: true },
    });

    const plainRuc = mainTenant?.businessConfig?.ruc
      ? this.encryption.decrypt(mainTenant.businessConfig.ruc)
      : null;

    const allTenants = await this.prisma.tenant.findMany({
      where: { active: true },
      include: {
        businessConfig: true,
        _count: {
          select: {
            productModels: { where: { active: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const sucursalesRaw = allTenants.filter((s) => {
      if (s.id === tenant.id) return true;
      if (plainRuc && s.businessConfig?.ruc) {
        return this.encryption.decrypt(s.businessConfig.ruc) === plainRuc;
      }
      return false;
    });

    const tenantIdsToQuery = sucursalesRaw.map((s) => s.id);
    if (!tenantIdsToQuery.includes(tenant.id)) tenantIdsToQuery.push(tenant.id);

    const sucursales = sucursalesRaw.map((s) => ({
      id: s.id,
      nombre: s.name,
      direccion: s.businessConfig?.direccion || 'Cantón Cevallos, Tungurahua',
      telefono: s.businessConfig?.telefono || s.businessConfig?.whatsappContacto || infoTienda.telefono,
      whatsapp: s.businessConfig?.whatsappContacto || s.businessConfig?.telefono || infoTienda.whatsappContacto,
      email: s.businessConfig?.email || infoTienda.email,
      totalModelos: s._count.productModels,
      isMatriz: s.id === tenant.id,
    }));

    // Cargar todos los modelos activos de la empresa con sus variantes de color y fotos
    const modelosRaw = await this.prisma.productModel.findMany({
      where: {
        tenantId: { in: tenantIdsToQuery },
        active: true,
      },
      include: {
        tenant: { select: { id: true, name: true } },
        products: {
          where: { active: true },
          include: {
            serie: true,
            stockByTalla: {
              include: { talla: true },
              orderBy: { talla: { numero: 'asc' } },
            },
          },
          orderBy: { code: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const modelos = modelosRaw.map((m) => {
      let precioMin = 0;
      let precioMax = 0;
      const precios = m.products.map((p) => Number(p.salePrice)).filter((pr) => pr > 0);
      if (precios.length > 0) {
        precioMin = Math.min(...precios);
        precioMax = Math.max(...precios);
      }

      return {
        id: m.id,
        baseCode: m.baseCode,
        name: m.name,
        brand: m.brand,
        material: m.material || '100% Cuero Vacuno',
        sucursalNombre: m.tenant?.name || 'Matriz',
        precioMin,
        precioMax,
        variantes: m.products.map((p) => {
          const sortedStock = (p.stockByTalla || [])
            .slice()
            .sort((a, b) => (Number(a.talla?.numero) || 0) - (Number(b.talla?.numero) || 0));

          const totalStock = sortedStock.reduce((acc, curr) => acc + (curr.quantity || 0), 0);

          return {
            id: p.id,
            code: p.code,
            color: p.color,
            imageUrl: p.imageUrl,
            salePrice: Number(p.salePrice),
            serieNombre: p.serie?.nombre || '',
            totalStock,
            tallas: sortedStock.map((st) => ({
              tallaId: st.tallaId,
              numero: st.talla?.numero,
              stock: st.quantity,
              disponible: (st.quantity || 0) - (st.reservedQuantity || 0),
            })),
          };
        }),
      };
    });

    return {
      negocio: infoTienda,
      sucursales,
      modelos,
    };
  }

  /**
   * Obtiene los modelos de calzado activos con sus productos, series, tallas y stock disponible para una sucursal específica.
   */
  async obtenerCatalogoPublico(tenantIdParam?: string) {
    const tenant = await this.resolveTenant(tenantIdParam);
    const infoTienda = await this.obtenerInfoTienda(tenant.id);

    const mainTenant = await this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      include: { businessConfig: true },
    });
    const rucToMatch = mainTenant?.businessConfig?.ruc;

    const sucursalesRaw = await this.prisma.tenant.findMany({
      where: {
        active: true,
        OR: [
          { id: tenant.id },
          ...(rucToMatch ? [{ businessConfig: { ruc: rucToMatch } }] : []),
        ],
      },
      include: {
        businessConfig: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const sucursales = sucursalesRaw.map((s) => ({
      id: s.id,
      nombre: s.name,
      direccion: s.businessConfig?.direccion || 'Cantón Cevallos, Tungurahua',
      telefono: s.businessConfig?.telefono || s.businessConfig?.whatsappContacto || infoTienda.telefono,
      whatsapp: s.businessConfig?.whatsappContacto || s.businessConfig?.telefono || infoTienda.whatsappContacto,
      isCurrent: s.id === tenant.id,
    }));

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
              orderBy: {
                talla: { numero: 'asc' },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const formattedModelos = modelos.map((m) => ({
      id: m.id,
      baseCode: m.baseCode,
      name: m.name,
      brand: m.brand,
      material: m.material,
      variantes: m.products.map((p) => {
        const sortedStockByTalla = (p.stockByTalla || [])
          .slice()
          .sort((a, b) => (Number(a.talla?.numero) || 0) - (Number(b.talla?.numero) || 0));

        const positiveQuantities = sortedStockByTalla.map((st) => st.quantity).filter((q) => q > 0);
        const minPositive = positiveQuantities.length > 0 ? Math.min(...positiveQuantities) : 1;

        return {
          id: p.id,
          code: p.code,
          color: p.color,
          imageUrl: p.imageUrl,
          costPrice: Number(p.costPrice),
          salePrice: Number(p.salePrice),
          serieNombre: p.serie.nombre,
          serieId: p.serie.id,
          tallas: sortedStockByTalla.map((st) => {
            const baseRatio = minPositive > 0 ? Math.max(1, Math.round(st.quantity / minPositive)) : 1;
            return {
              tallaId: st.tallaId,
              numero: st.talla?.numero,
              cantidad: st.quantity,
              stock: st.quantity,
              ratio: baseRatio,
              cantidadSerie: baseRatio,
            };
          }),
        };
      }),
    }));

    return {
      sucursalActual: {
        id: tenant.id,
        nombre: tenant.name,
        direccion: infoTienda.direccion,
        telefono: infoTienda.telefono,
        whatsappContacto: infoTienda.whatsappContacto,
      },
      negocio: infoTienda,
      sucursales,
      modelos: formattedModelos,
    };
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
