import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../shared/infrastructure/encryption/encryption.service';
import { CloudinaryService } from '../shared/infrastructure/cloudinary/cloudinary.service';
import { NivelCredito } from '@prisma/client';
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
    if (!config) return null;

    return {
      ...config,
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
}
