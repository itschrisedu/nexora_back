import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import { GastosService } from '../application/GastosService';
import { CreateGastoDto, UpdateGastoDto, GastoFiltrosDto } from '../application/dto/gastos.dto';

@Controller('gastos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GastosController {
  constructor(private readonly gastosService: GastosService) {}

  @Post()
  @Roles(Rol.ROL_SUPER_ADMIN, Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async crearGasto(@Req() req: any, @Body() dto: CreateGastoDto) {
    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.id;
    return this.gastosService.crearGasto(tenantId, userId, dto);
  }

  @Get()
  @Roles(Rol.ROL_SUPER_ADMIN, Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async listarGastos(@Req() req: any, @Query() filtros: GastoFiltrosDto) {
    const tenantId = req.user.tenantId;
    return this.gastosService.listarGastos(tenantId, filtros);
  }

  @Get('stats')
  @Roles(Rol.ROL_SUPER_ADMIN, Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async obtenerEstadisticas(
    @Req() req: any,
    @Query('mes') mes?: number,
    @Query('anio') anio?: number,
    @Query('sucursalId') sucursalId?: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.gastosService.obtenerEstadisticasGastos(tenantId, mes, anio, sucursalId);
  }

  @Get(':id')
  @Roles(Rol.ROL_SUPER_ADMIN, Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async obtenerGasto(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    return this.gastosService.obtenerGastoPorId(id, tenantId);
  }

  @Put(':id')
  @Roles(Rol.ROL_SUPER_ADMIN, Rol.ROL_ADMIN)
  async actualizarGasto(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateGastoDto,
  ) {
    const tenantId = req.user.tenantId;
    return this.gastosService.actualizarGasto(id, tenantId, dto);
  }

  @Delete(':id')
  @Roles(Rol.ROL_SUPER_ADMIN, Rol.ROL_ADMIN)
  async eliminarGasto(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    return this.gastosService.eliminarGasto(id, tenantId);
  }
}
