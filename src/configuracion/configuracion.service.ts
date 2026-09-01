import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../shared/infrastructure/encryption/encryption.service';
import { CloudinaryService } from '../shared/infrastructure/cloudinary/cloudinary.service';
import { NivelCredito, Rol } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ActiveSessionStore } from '../auth/active-session.store';
import {
  CreateSeasonDto,
  CreateSeriesDto,
  CreateSeriesWithTallasDto,
  CreateTallaDto,
  UpdateBusinessConfigDto,
  UpdateSeasonDto,
  UpdateSeriesDto,
} from './dto/configuracion.dto';

@Injectable()
export class ConfiguracionService {
  private readonly logger = new Logger(ConfiguracionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ══════════════════════════════
  // BUSINESS CONFIG
  // ══════════════════════════════

  async getBusinessConfig(tenantId: string) {
    if (!tenantId) return null;
    const config = await this.prisma.businessConfig.findUnique({ where: { tenantId } });
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const nombreNegocio = config?.nombre || tenant?.name || 'Local Comercial';

    if (!config) {
      return {
        nombre: nombreNegocio,
        ruc: '',
        direccion: 'Cantón Cevallos, Tungurahua',
        telefono: '',
        tieneP12: false,
      };
    }

    return {
      ...config,
      nombre: nombreNegocio,
      ruc: this.encryption.decrypt(config.ruc), // Descifrar RUC para mostrar
      firmaPasswordEnc: undefined, // Nunca enviar contraseña cifrada al frontend
      tieneP12: !!config.firmaP12Path, // Indicador booleano para el frontend
    };
  }

  async upsertBusinessConfig(dto: UpdateBusinessConfigDto, tenantId: string) {
    const encryptedRuc = this.encryption.encrypt(dto.ruc);
    const existing = await this.prisma.businessConfig.findUnique({ where: { tenantId } });

    // Construir data excluyendo campos que no deben ir directo
    const data: any = {
      nombre: dto.nombre,
      ruc: encryptedRuc,
      direccion: dto.direccion,
      telefono: dto.telefono,
      email: dto.email,
      logoUrl: dto.logoUrl,
      primaryColor: dto.primaryColor,
    };

    if (dto.horaInicioOperativa !== undefined) data.horaInicioOperativa = dto.horaInicioOperativa;
    if (dto.horaFinOperativa !== undefined) data.horaFinOperativa = dto.horaFinOperativa;
    if (dto.duracionSesionHoras !== undefined) data.duracionSesionHoras = dto.duracionSesionHoras;

    // Campos SRI opcionales (solo incluir si fueron enviados)
    if (dto.sriAmbiente !== undefined) data.sriAmbiente = dto.sriAmbiente;
    if (dto.sriEstablecimiento !== undefined) data.sriEstablecimiento = dto.sriEstablecimiento;
    if (dto.sriPuntoEmision !== undefined) data.sriPuntoEmision = dto.sriPuntoEmision;
    if (dto.sriObligadoContabilidad !== undefined) data.sriObligadoContabilidad = dto.sriObligadoContabilidad;

    // Parámetros de Credit Scoring
    if (dto.creditMontoMaximoInicial !== undefined) data.creditMontoMaximoInicial = dto.creditMontoMaximoInicial;
    if (dto.creditPlazoMaximoDias !== undefined) data.creditPlazoMaximoDias = dto.creditPlazoMaximoDias;
    if (dto.creditScoreMinimo !== undefined) data.creditScoreMinimo = dto.creditScoreMinimo;
    if (dto.creditTasaMoraPct !== undefined) data.creditTasaMoraPct = dto.creditTasaMoraPct;

    if (existing) {
      if (existing.logoUrl && existing.logoUrl !== dto.logoUrl && existing.logoUrl.includes('cloudinary.com')) {
        await this.cloudinary.deleteImage(existing.logoUrl);
      }
      const updated = await this.prisma.businessConfig.update({
        where: { id: existing.id },
        data,
      });
      this.logger.log('Configuración del negocio actualizada');
      return { ...updated, ruc: dto.ruc, firmaPasswordEnc: undefined };
    }

    const created = await this.prisma.businessConfig.create({
      data: { ...data, tenantId },
    });
    this.logger.log('Configuración del negocio creada');
    return { ...created, ruc: dto.ruc, firmaPasswordEnc: undefined };
  }

  // ══════════════════════════════
  // NIVELES DE CRÉDITO (SCORING)
  // ══════════════════════════════

  async getNivelesCredito() {
    return this.prisma.creditLevelConfig.findMany({
      orderBy: { comprasRequeridas: 'asc' },
    });
  }

  async updateNivelesCredito(niveles: Array<{ nivel: NivelCredito; limiteDolares: number; plazoDias: number; comprasRequeridas: number }>) {
    const results = [];
    for (const item of niveles) {
      const updated = await this.prisma.creditLevelConfig.upsert({
        where: { nivel: item.nivel },
        update: {
          limiteDolares: item.limiteDolares,
          plazoDias: item.plazoDias,
          comprasRequeridas: item.comprasRequeridas,
        },
        create: {
          nivel: item.nivel,
          limiteDolares: item.limiteDolares,
          plazoDias: item.plazoDias,
          comprasRequeridas: item.comprasRequeridas,
        },
      });
      results.push(updated);
    }
    return results;
  }

  // ══════════════════════════════
  // GEOLOCALIZACIÓN DE VENDEDORES
  // ══════════════════════════════

  async registrarUbicacionVendedor(userId: string, lat: number, lng: number, direccion?: string) {
    return this.prisma.vendorLocation.create({
      data: {
        userId,
        lat,
        lng,
        direccion: direccion || undefined,
      },
    });
  }

  async obtenerUbicacionesVendedores(tenantId?: string | null) {
    const where: any = {
      rol: { in: ['ROL_VENDEDOR', 'ROL_BODEGUERO', 'ROL_ADMIN'] },
    };
    if (tenantId) {
      where.tenantId = tenantId;
    }

    const vendedores = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        tenantId: true,
        tenant: { select: { name: true } },
        vendorLocations: {
          take: 1,
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    return vendedores.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      email: v.email,
      rol: v.rol,
      tenantId: v.tenantId,
      sucursal: v.tenant?.name || 'General',
      ultimaUbicacion: v.vendorLocations[0] || null,
    }));
  }

  /**
   * Guarda la ruta del archivo .p12 y su contraseña cifrada con AES-256
   */
  async guardarFirmaP12(tenantId: string, filePath: string, password: string) {
    const config = await this.prisma.businessConfig.findUnique({ where: { tenantId } });
    if (!config) {
      throw new NotFoundException('Configuración del negocio no encontrada. Cree la configuración primero.');
    }

    const encryptedPassword = this.encryption.encrypt(password);

    const updated = await this.prisma.businessConfig.update({
      where: { id: config.id },
      data: {
        firmaP12Path: filePath,
        firmaPasswordEnc: encryptedPassword,
      },
    });

    this.logger.log(`Firma electrónica .p12 guardada para tenant ${tenantId}`);
    return { ...updated, firmaPasswordEnc: undefined, tieneP12: true };
  }

  // ══════════════════════════════
  // SEASONS (Temporadas)
  // ══════════════════════════════

  async getAllSeasons(tenantId?: string | null) {
    const where: any = {};
    if (tenantId) {
      where.tenantId = tenantId;
    }
    return this.prisma.season.findMany({ where, orderBy: { fechaInicio: 'desc' } });
  }

  async createSeason(dto: CreateSeasonDto, tenantId: string) {
    const season = await this.prisma.season.create({
      data: {
        nombre: dto.nombre,
        tipo: dto.tipo,
        fechaInicio: new Date(dto.fechaInicio),
        fechaFin: new Date(dto.fechaFin),
        tenantId,
      },
    });
    this.logger.log(`Temporada creada: ${season.nombre}`);
    return season;
  }

  async updateSeason(id: string, dto: UpdateSeasonDto) {
    const existing = await this.prisma.season.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Temporada no encontrada');

    const data: Record<string, unknown> = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.tipo !== undefined) data.tipo = dto.tipo;
    if (dto.fechaInicio !== undefined) data.fechaInicio = new Date(dto.fechaInicio);
    if (dto.fechaFin !== undefined) data.fechaFin = new Date(dto.fechaFin);
    if (dto.activa !== undefined) data.activa = dto.activa;

    return this.prisma.season.update({ where: { id }, data });
  }

  async deleteSeason(id: string) {
    const existing = await this.prisma.season.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Temporada no encontrada');
    await this.prisma.season.delete({ where: { id } });
    this.logger.log(`Temporada eliminada: ${existing.nombre}`);
    return { message: 'Temporada eliminada' };
  }

  // ══════════════════════════════
  // SERIES CONFIG
  // ══════════════════════════════

  async getAllSeries() {
    return this.prisma.seriesConfig.findMany({
      include: { tallas: { orderBy: { numero: 'asc' } } },
      orderBy: { nombre: 'asc' },
    });
  }

  async createSeries(dto: CreateSeriesDto) {
    const exists = await this.prisma.seriesConfig.findUnique({
      where: { nombre: dto.nombre },
    });
    if (exists) throw new ConflictException(`La serie "${dto.nombre}" ya existe`);

    const series = await this.prisma.seriesConfig.create({
      data: { nombre: dto.nombre },
    });
    this.logger.log(`Serie creada: ${series.nombre}`);
    return series;
  }

  async toggleSeriesActiva(id: string) {
    const existing = await this.prisma.seriesConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Serie no encontrada');

    return this.prisma.seriesConfig.update({
      where: { id },
      data: { activa: !existing.activa },
    });
  }

  /**
   * Crea una serie completa con su rango de tallas generado automáticamente.
   */
  async createSeriesWithTallas(dto: CreateSeriesWithTallasDto) {
    const nombreUpper = dto.nombre.toUpperCase().trim().replace(/\s+/g, '_');

    const exists = await this.prisma.seriesConfig.findUnique({
      where: { nombre: nombreUpper },
    });
    if (exists) throw new ConflictException(`La serie "${nombreUpper}" ya existe`);

    if (dto.tallasHasta < dto.tallasDesde) {
      throw new ConflictException('El rango de tallas es inválido: "tallasHasta" debe ser >= "tallasDesde"');
    }

    const series = await this.prisma.seriesConfig.create({
      data: { nombre: nombreUpper },
    });

    // Generar tallas del rango
    const tallasData: { numero: number; serieId: string }[] = [];
    for (let n = dto.tallasDesde; n <= dto.tallasHasta; n++) {
      tallasData.push({ numero: n, serieId: series.id });
    }

    await this.prisma.tallaConfig.createMany({ data: tallasData });

    this.logger.log(`Serie "${nombreUpper}" creada con tallas ${dto.tallasDesde}-${dto.tallasHasta}`);

    return this.prisma.seriesConfig.findUnique({
      where: { id: series.id },
      include: { tallas: { orderBy: { numero: 'asc' } } },
    });
  }

  /**
   * Actualiza una serie existente: nombre y/o rango de tallas.
   * Si se cambian las tallas, elimina las antiguas sin stock y crea las nuevas.
   */
  async updateSeries(id: string, dto: UpdateSeriesDto) {
    const existing = await this.prisma.seriesConfig.findUnique({
      where: { id },
      include: { tallas: true },
    });
    if (!existing) throw new NotFoundException('Serie no encontrada');

    // Actualizar nombre si se proporcionó
    if (dto.nombre) {
      const nombreUpper = dto.nombre.toUpperCase().trim().replace(/\s+/g, '_');
      const conflict = await this.prisma.seriesConfig.findFirst({
        where: { nombre: nombreUpper, id: { not: id } },
      });
      if (conflict) throw new ConflictException(`Ya existe una serie con el nombre "${nombreUpper}"`);

      await this.prisma.seriesConfig.update({
        where: { id },
        data: { nombre: nombreUpper },
      });
    }

    // Reconfigurar tallas si se proporcionó rango
    if (dto.tallasDesde !== undefined && dto.tallasHasta !== undefined) {
      if (dto.tallasHasta < dto.tallasDesde) {
        throw new ConflictException('El rango de tallas es inválido');
      }

      const nuevosNumeros = new Set<number>();
      for (let n = dto.tallasDesde; n <= dto.tallasHasta; n++) {
        nuevosNumeros.add(n);
      }

      // Determinar tallas a agregar y a eliminar
      const tallasExistentes = existing.tallas;
      const numerosExistentes = new Set(tallasExistentes.map(t => t.numero));

      // Tallas a eliminar: las que ya no están en el nuevo rango
      const tallasParaEliminar = tallasExistentes.filter(t => !nuevosNumeros.has(t.numero));

      // Antes de eliminar, verificar que no tengan stock asociado
      for (const talla of tallasParaEliminar) {
        const stockCount = await this.prisma.stockByTalla.count({
          where: { tallaId: talla.id },
        });
        if (stockCount > 0) {
          // Eliminar el stock asociado a esta talla
          await this.prisma.stockByTalla.deleteMany({
            where: { tallaId: talla.id },
          });
          this.logger.warn(`Eliminado stock de talla ${talla.numero} al reconfigurar serie ${existing.nombre}`);
        }
        await this.prisma.tallaConfig.delete({ where: { id: talla.id } });
      }

      // Tallas a agregar: las que son nuevas
      const tallasParaAgregar: { numero: number; serieId: string }[] = [];
      for (const num of nuevosNumeros) {
        if (!numerosExistentes.has(num)) {
          tallasParaAgregar.push({ numero: num, serieId: id });
        }
      }

      if (tallasParaAgregar.length > 0) {
        await this.prisma.tallaConfig.createMany({ data: tallasParaAgregar });
      }

      this.logger.log(`Serie "${existing.nombre}" reconfigurada: tallas ${dto.tallasDesde}-${dto.tallasHasta}`);
    }

    return this.prisma.seriesConfig.findUnique({
      where: { id },
      include: { tallas: { orderBy: { numero: 'asc' } } },
    });
  }

  /**
   * Elimina una serie si no tiene productos asociados.
   */
  async deleteSeries(id: string) {
    const existing = await this.prisma.seriesConfig.findUnique({
      where: { id },
      include: { products: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('Serie no encontrada');

    if (existing.products.length > 0) {
      throw new ConflictException(
        `No se puede eliminar la serie "${existing.nombre}" porque tiene ${existing.products.length} producto(s) asociado(s). Elimine los productos primero.`
      );
    }

    // Eliminar tallas asociadas (cascade debería hacerlo, pero por seguridad)
    await this.prisma.tallaConfig.deleteMany({ where: { serieId: id } });
    await this.prisma.seriesConfig.delete({ where: { id } });

    this.logger.log(`Serie "${existing.nombre}" eliminada`);
    return { message: `Serie "${existing.nombre}" eliminada correctamente` };
  }

  // ══════════════════════════════
  // TALLA CONFIG
  // ══════════════════════════════

  async createTalla(dto: CreateTallaDto) {
    const series = await this.prisma.seriesConfig.findUnique({
      where: { id: dto.serieId },
    });
    if (!series) throw new NotFoundException('Serie no encontrada');

    const talla = await this.prisma.tallaConfig.create({
      data: { numero: dto.numero, serieId: dto.serieId },
    });
    this.logger.log(`Talla ${dto.numero} creada para serie ${series.nombre}`);
    return talla;
  }

  async deleteTalla(id: string) {
    const existing = await this.prisma.tallaConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Talla no encontrada');
    await this.prisma.tallaConfig.delete({ where: { id } });
    return { message: 'Talla eliminada' };
  }

  // ══════════════════════════════
  // SUCURSALES (Gestión Multi-Sucursal por Empresa)
  // ══════════════════════════════

  /**
   * Obtiene la lista de todas las sucursales pertenecientes a la organización.
   */
  async getSucursales(tenantId: string) {
    const sucursales = await this.prisma.tenant.findMany({
      where: {
        OR: [
          { id: tenantId },
          { name: { contains: 'Sucursal', mode: 'insensitive' } },
        ],
      },
      include: {
        businessConfig: {
          select: {
            nombre: true,
            direccion: true,
            telefono: true,
            email: true,
            logoUrl: true,
          },
        },
        _count: {
          select: {
            users: true,
            orders: true,
            productModels: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return sucursales.map((s) => ({
      id: s.id,
      name: s.name,
      active: s.active,
      isMatriz: s.id === tenantId,
      isCurrent: s.id === tenantId,
      direccion: s.businessConfig?.direccion || 'Sin dirección',
      telefono: s.businessConfig?.telefono || '',
      email: s.businessConfig?.email || '',
      stats: {
        usuarios: s._count.users,
        pedidos: s._count.orders,
        modelos: s._count.productModels,
      },
      createdAt: s.createdAt,
    }));
  }

  /**
   * Crea una nueva sucursal para la empresa del Administrador.
   */
  async createSucursal(
    tenantId: string,
    data: {
      name: string;
      direccion?: string;
      telefono?: string;
      email?: string;
      adminEmail?: string;
      adminNombre?: string;
      adminPassword?: string;
    },
  ) {
    const currentTenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { businessConfig: true },
    });

    if (!currentTenant) throw new NotFoundException('Empresa no encontrada');

    const sucursal = await this.prisma.$transaction(async (tx) => {
      // 1. Crear el tenant de la sucursal
      const childTenant = await tx.tenant.create({
        data: {
          name: data.name,
          active: true,
        },
      });

      // 2. Crear configuración comercial inicial para la sucursal
      await tx.businessConfig.create({
        data: {
          tenantId: childTenant.id,
          nombre: data.name,
          ruc: currentTenant.businessConfig?.ruc || this.encryption.encrypt('0000000000001'),
          direccion: data.direccion || currentTenant.businessConfig?.direccion || 'Cevallos, Ecuador',
          telefono: data.telefono || currentTenant.businessConfig?.telefono,
          email: data.email || currentTenant.businessConfig?.email,
          logoUrl: currentTenant.businessConfig?.logoUrl,
          primaryColor: currentTenant.businessConfig?.primaryColor || '#0F172A',
        },
      });

      // 3. Crear usuario encargado/vendedor si se proporcionó
      if (data.adminEmail && data.adminPassword) {
        const passwordHash = await bcrypt.hash(data.adminPassword, 12);
        await tx.user.create({
          data: {
            email: data.adminEmail,
            nombre: data.adminNombre || `Encargado ${data.name}`,
            rol: Rol.ROL_ADMIN,
            passwordHash,
            activo: true,
            tenantId: childTenant.id,
          },
        });
      }

      return childTenant;
    });

    this.logger.log(`Nueva sucursal creada: "${sucursal.name}"`);
    return this.getSucursales(tenantId);
  }

  /**
   * Actualiza los datos de una sucursal (nombre, dirección, teléfono, email, estado).
   */
  async updateSucursal(
    tenantId: string,
    sucursalId: string,
    data: {
      name?: string;
      direccion?: string;
      telefono?: string;
      email?: string;
      active?: boolean;
    },
  ) {
    const sucursal = await this.prisma.tenant.findUnique({
      where: { id: sucursalId },
      include: { businessConfig: true },
    });

    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }

    await this.prisma.$transaction(async (tx) => {
      // Actualizar Tenant
      if (data.name !== undefined || data.active !== undefined) {
        await tx.tenant.update({
          where: { id: sucursalId },
          data: {
            ...(data.name !== undefined && { name: data.name }),
            ...(data.active !== undefined && { active: data.active }),
          },
        });
      }

      // Actualizar BusinessConfig
      if (sucursal.businessConfig) {
        const configData: any = {};
        if (data.name !== undefined) configData.nombre = data.name;
        if (data.direccion !== undefined) configData.direccion = data.direccion;
        if (data.telefono !== undefined) configData.telefono = data.telefono;
        if (data.email !== undefined) configData.email = data.email;

        if (Object.keys(configData).length > 0) {
          await tx.businessConfig.update({
            where: { id: sucursal.businessConfig.id },
            data: configData,
          });
        }
      }
    });

    this.logger.log(`Sucursal "${data.name || sucursal.name}" actualizada`);
    return this.getSucursales(tenantId);
  }

  /**
   * Obtiene el personal asignado a una sucursal específica.
   */
  async getPersonalBySucursal(sucursalId: string) {
    return this.prisma.user.findMany({
      where: { tenantId: sucursalId },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        permiteCambiarPrecio: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Transfiere un colaborador de una sucursal a otra.
   */
  async transferirPersonal(
    tenantId: string,
    userId: string,
    targetTenantId: string,
  ) {
    if (!targetTenantId) {
      throw new BadRequestException('Debe especificar la sucursal destino');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Colaborador no encontrado');
    }

    const targetTenant = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
    });

    if (!targetTenant) {
      throw new NotFoundException('Sucursal destino no encontrada');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { tenantId: targetTenantId },
    });

    this.logger.log(
      `Colaborador "${user.nombre}" transferido a sucursal "${targetTenant.name}"`,
    );

    return {
      message: `${user.nombre} transferido a ${targetTenant.name}`,
    };
  }

  // ══════════════════════════════
  // GESTIÓN DE PERSONAL Y RESEÑA DE CLAVES
  // ══════════════════════════════

  /**
   * Obtiene la lista de colaboradores del local/sucursal.
   */
  async getPersonal(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        permiteCambiarPrecio: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Actualiza los datos de un colaborador (nombre, email, rol, activo, permisos).
   */
  async updatePersonal(
    tenantId: string,
    userId: string,
    data: {
      nombre?: string;
      email?: string;
      rol?: Rol;
      activo?: boolean;
      permiteCambiarPrecio?: boolean;
    },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('Colaborador no encontrado en este local');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        nombre: data.nombre !== undefined ? data.nombre : user.nombre,
        email: data.email !== undefined ? data.email : user.email,
        rol: data.rol !== undefined ? data.rol : user.rol,
        activo: data.activo !== undefined ? data.activo : user.activo,
        permiteCambiarPrecio:
          data.permiteCambiarPrecio !== undefined
            ? data.permiteCambiarPrecio
            : user.permiteCambiarPrecio,
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        permiteCambiarPrecio: true,
      },
    });

    this.logger.log(`Colaborador "${updated.nombre}" (${updated.email}) actualizado por Administrador.`);
    return updated;
  }

  /**
   * Restablece la contraseña de un colaborador.
   */
  async resetPasswordPersonal(tenantId: string, userId: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('La nueva contraseña debe tener al menos 6 caracteres.');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('Colaborador no encontrado en este local');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    ActiveSessionStore.invalidate(userId); // Invalida sesión previa para forzar login con nueva clave

    this.logger.log(`Contraseña restablecida exitosamente para el usuario ${user.email}`);
    return { message: `Contraseña restablecida exitosamente para ${user.nombre}` };
  }

  // ══════════════════════════════
  // INVENTARIO INTER-SUCURSAL
  // ══════════════════════════════

  /**
   * Consulta el stock disponible de un modelo/producto en las demás sucursales de la misma empresa.
   */
  async getStockInterSucursal(tenantId: string, searchCodeOrName: string) {
    // Buscar sucursales hermanas
    const sucursalesHermanas = await this.prisma.tenant.findMany({
      where: {
        id: { not: tenantId }, // Excluir la sucursal actual
      },
      select: { id: true, name: true },
    });

    if (sucursalesHermanas.length === 0) {
      return [];
    }

    const tenantIds = sucursalesHermanas.map((s) => s.id);

    // Buscar productos en esas sucursales que coincidan por código o nombre
    const models = await this.prisma.productModel.findMany({
      where: {
        tenantId: { in: tenantIds },
        OR: [
          { baseCode: { contains: searchCodeOrName, mode: 'insensitive' } },
          { name: { contains: searchCodeOrName, mode: 'insensitive' } },
        ],
      },
      include: {
        tenant: { select: { id: true, name: true } },
        products: {
          include: {
            stockByTalla: {
              include: { talla: true },
            },
          },
        },
      },
    });

    const resultados: any[] = [];

    for (const m of models) {
      for (const p of m.products) {
        const totalPares = p.stockByTalla.reduce((acc, st) => acc + st.quantity, 0);
        if (totalPares > 0) {
          resultados.push({
            sucursalId: m.tenant.id,
            sucursalNombre: m.tenant.name,
            modeloId: m.id,
            modeloNombre: m.name,
            codigo: p.code,
            color: p.color,
            precioVenta: Number(p.salePrice),
            stockTotal: totalPares,
            tallasDisponibles: p.stockByTalla.map((st) => ({
              talla: st.talla.numero,
              cantidad: st.quantity,
            })),
          });
        }
      }
    }

    return resultados;
  }
}
