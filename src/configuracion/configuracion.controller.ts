import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ConfiguracionService } from './configuracion.service';
import {
  CreateSeasonDto,
  CreateSeriesDto,
  CreateSeriesWithTallasDto,
  CreateTallaDto,
  UpdateBusinessConfigDto,
  RegistrarUbicacionDto,
  UpdateSeasonDto,
  UpdateSeriesDto,
} from './dto/configuracion.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';

@Controller('configuracion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConfiguracionController {
  constructor(private readonly configuracionService: ConfiguracionService) {}

  // ══════════════════════════════
  // BUSINESS CONFIG
  // ══════════════════════════════

  @Get('negocio')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async getBusinessConfig(@Req() req: any) {
    return this.configuracionService.getBusinessConfig(req.user.tenantId);
  }

  @Put('negocio')
  @Roles(Rol.ROL_ADMIN)
  async upsertBusinessConfig(@Body() dto: UpdateBusinessConfigDto, @Req() req: any) {
    return this.configuracionService.upsertBusinessConfig(dto, req.user.tenantId);
  }

  // ══════════════════════════════
  // GEOLOCALIZACIÓN VENDEDORES
  // ══════════════════════════════

  @Post('geolocalizacion')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO)
  async registrarUbicacion(@Body() dto: RegistrarUbicacionDto, @Req() req: any) {
    return this.configuracionService.registrarUbicacionVendedor(req.user.id, dto.lat, dto.lng, dto.direccion);
  }

  @Get('geolocalizacion/vendedores')
  @Roles(Rol.ROL_ADMIN)
  async obtenerUbicacionesVendedores(@Req() req: any) {
    return this.configuracionService.obtenerUbicacionesVendedores(req.user.tenantId);
  }

  // ══════════════════════════════
  // SEASONS
  // ══════════════════════════════

  @Get('temporadas')
  @Roles(Rol.ROL_ADMIN)
  async getAllSeasons(@Req() req: any) {
    return this.configuracionService.getAllSeasons(req.user.tenantId);
  }

  @Post('temporadas')
  @Roles(Rol.ROL_ADMIN)
  async createSeason(@Body() dto: CreateSeasonDto, @Req() req: any) {
    return this.configuracionService.createSeason(dto, req.user.tenantId);
  }

  @Patch('temporadas/:id')
  @Roles(Rol.ROL_ADMIN)
  async updateSeason(@Param('id') id: string, @Body() dto: UpdateSeasonDto) {
    return this.configuracionService.updateSeason(id, dto);
  }

  @Delete('temporadas/:id')
  @Roles(Rol.ROL_ADMIN)
  async deleteSeason(@Param('id') id: string) {
    return this.configuracionService.deleteSeason(id);
  }

  // ══════════════════════════════
  // SERIES
  // ══════════════════════════════

  @Get('series')
  @Roles(Rol.ROL_ADMIN)
  async getAllSeries() {
    return this.configuracionService.getAllSeries();
  }

  @Post('series')
  @Roles(Rol.ROL_ADMIN)
  async createSeries(@Body() dto: CreateSeriesDto) {
    return this.configuracionService.createSeries(dto);
  }

  @Patch('series/:id/toggle')
  @Roles(Rol.ROL_ADMIN)
  async toggleSeriesActiva(@Param('id') id: string) {
    return this.configuracionService.toggleSeriesActiva(id);
  }

  @Post('series-completa')
  @Roles(Rol.ROL_ADMIN)
  async createSeriesWithTallas(@Body() dto: CreateSeriesWithTallasDto) {
    return this.configuracionService.createSeriesWithTallas(dto);
  }

  @Put('series/:id')
  @Roles(Rol.ROL_ADMIN)
  async updateSeries(@Param('id') id: string, @Body() dto: UpdateSeriesDto) {
    return this.configuracionService.updateSeries(id, dto);
  }

  @Delete('series/:id')
  @Roles(Rol.ROL_ADMIN)
  async deleteSeries(@Param('id') id: string) {
    return this.configuracionService.deleteSeries(id);
  }

  // ══════════════════════════════
  // TALLAS
  // ══════════════════════════════

  @Post('tallas')
  @Roles(Rol.ROL_ADMIN)
  async createTalla(@Body() dto: CreateTallaDto) {
    return this.configuracionService.createTalla(dto);
  }

  @Delete('tallas/:id')
  @Roles(Rol.ROL_ADMIN)
  async deleteTalla(@Param('id') id: string) {
    return this.configuracionService.deleteTalla(id);
  }

  // ══════════════════════════════
  // FACTURACIÓN ELECTRÓNICA SRI (Fase 12)
  // ══════════════════════════════

  /**
   * POST /configuracion/sri/firma-p12
   * Sube el archivo de firma electrónica .p12 y guarda la contraseña cifrada.
   * El archivo se almacena en ./uploads/firmas/{tenantId}/firma.p12
   */
  @Post('sri/firma-p12')
  @Roles(Rol.ROL_ADMIN)
  @UseInterceptors(
    FileInterceptor('firma', {
      storage: diskStorage({
        destination: (req: any, _file, cb) => {
          const tenantId = req.user?.tenantId || 'default';
          const dir = join(process.cwd(), 'uploads', 'firmas', tenantId);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `firma${ext}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (ext !== '.p12' && ext !== '.pfx') {
          return cb(
            new BadRequestException('Solo se permiten archivos .p12 o .pfx'),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // Máximo 5 MB
    }),
  )
  async subirFirmaP12(
    @UploadedFile() file: Express.Multer.File,
    @Body('password') password: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Debe adjuntar un archivo .p12');
    }
    if (!password) {
      throw new BadRequestException('Debe proporcionar la contraseña de la firma');
    }

    return this.configuracionService.guardarFirmaP12(
      req.user.tenantId,
      file.path,
      password,
    );
  }
}
