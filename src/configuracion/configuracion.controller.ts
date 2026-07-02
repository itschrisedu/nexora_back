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
} from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';
import {
  CreateSeasonDto,
  CreateSeriesDto,
  CreateTallaDto,
  UpdateBusinessConfigDto,
  UpdateSeasonDto,
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
  @Roles(Rol.ROL_ADMIN)
  async getBusinessConfig() {
    return this.configuracionService.getBusinessConfig();
  }

  @Put('negocio')
  @Roles(Rol.ROL_ADMIN)
  async upsertBusinessConfig(@Body() dto: UpdateBusinessConfigDto) {
    return this.configuracionService.upsertBusinessConfig(dto);
  }

  // ══════════════════════════════
  // SEASONS
  // ══════════════════════════════

  @Get('temporadas')
  @Roles(Rol.ROL_ADMIN)
  async getAllSeasons() {
    return this.configuracionService.getAllSeasons();
  }

  @Post('temporadas')
  @Roles(Rol.ROL_ADMIN)
  async createSeason(@Body() dto: CreateSeasonDto) {
    return this.configuracionService.createSeason(dto);
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
}
