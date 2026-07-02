import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../shared/infrastructure/encryption/encryption.service';
import {
  CreateSeasonDto,
  CreateSeriesDto,
  CreateTallaDto,
  UpdateBusinessConfigDto,
  UpdateSeasonDto,
} from './dto/configuracion.dto';

@Injectable()
export class ConfiguracionService {
  private readonly logger = new Logger(ConfiguracionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  // ══════════════════════════════
  // BUSINESS CONFIG
  // ══════════════════════════════

  async getBusinessConfig() {
    const config = await this.prisma.businessConfig.findFirst();
    if (!config) return null;

    return {
      ...config,
      ruc: this.encryption.decrypt(config.ruc), // Descifrar RUC para mostrar
    };
  }

  async upsertBusinessConfig(dto: UpdateBusinessConfigDto) {
    const encryptedRuc = this.encryption.encrypt(dto.ruc);
    const existing = await this.prisma.businessConfig.findFirst();

    if (existing) {
      const updated = await this.prisma.businessConfig.update({
        where: { id: existing.id },
        data: { ...dto, ruc: encryptedRuc },
      });
      this.logger.log('Configuración del negocio actualizada');
      return { ...updated, ruc: dto.ruc };
    }

    const created = await this.prisma.businessConfig.create({
      data: { ...dto, ruc: encryptedRuc },
    });
    this.logger.log('Configuración del negocio creada');
    return { ...created, ruc: dto.ruc };
  }

  // ══════════════════════════════
  // SEASONS (Temporadas)
  // ══════════════════════════════

  async getAllSeasons() {
    return this.prisma.season.findMany({ orderBy: { fechaInicio: 'desc' } });
  }

  async createSeason(dto: CreateSeasonDto) {
    const season = await this.prisma.season.create({
      data: {
        nombre: dto.nombre,
        tipo: dto.tipo,
        fechaInicio: new Date(dto.fechaInicio),
        fechaFin: new Date(dto.fechaFin),
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
