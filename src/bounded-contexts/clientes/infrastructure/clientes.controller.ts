import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFloatPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import {
  RegistrarClienteDto,
  ActualizarClienteDto,
  AjustarNivelDto,
  BuscarClientesDto,
} from './dto/clientes.dto';
import { RegistrarClienteHandler } from '../application/commands/RegistrarCliente.handler';
import { RegistrarClienteCommand } from '../application/commands/RegistrarCliente.command';
import { ActualizarClienteHandler } from '../application/commands/ActualizarCliente.handler';
import { ActualizarClienteCommand } from '../application/commands/ActualizarCliente.command';
import { AjustarNivelManualmenteHandler } from '../application/commands/AjustarNivelManualmente.handler';
import { AjustarNivelManualmenteCommand } from '../application/commands/AjustarNivelManualmente.command';
import { ClientesQueryService } from '../application/queries/ClientesQueryService';
import {
  validarCedula,
  validarRuc,
  validarTelefonoCelular,
  normalizarTelefonoCelular,
} from '../../../shared/utils/ecuador-validators';

@Controller('clientes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientesController {
  constructor(
    private readonly registrarClienteHandler: RegistrarClienteHandler,
    private readonly actualizarClienteHandler: ActualizarClienteHandler,
    private readonly ajustarNivelManualmenteHandler: AjustarNivelManualmenteHandler,
    private readonly queryService: ClientesQueryService,
  ) {}

  // ══════════════════════════════
  // QUERIES
  // ══════════════════════════════

  @Get()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async buscarClientes(@Query() query: BuscarClientesDto, @Req() req: any) {
    return this.queryService.buscarClientes(query, req.user.tenantId);
  }

  // ── CRM: Clientes Inactivos (>30 días) ──
  @Get('inactivos')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async obtenerClientesInactivos(@Query('dias') dias: string, @Req() req: any) {
    return this.queryService.obtenerClientesInactivos(
      req.user.tenantId,
      dias ? parseInt(dias, 10) : 30,
    );
  }

  // ── CRM: Campañas Promocionales & Cupones ──
  @Get('promociones')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async obtenerPromociones(@Req() req: any) {
    return this.queryService.obtenerPromociones(req.user.tenantId);
  }

  @Post('promociones')
  @Roles(Rol.ROL_ADMIN)
  async crearPromocion(@Body() dto: any, @Req() req: any) {
    return this.queryService.crearPromocion(req.user.tenantId, dto);
  }

  @Post('promociones/validar')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async validarCupon(@Body() dto: any, @Req() req: any) {
    return this.queryService.validarCupon(
      req.user.tenantId,
      dto.codigo,
      dto.totalPares,
      dto.totalMonto,
      dto.tipoPago,
    );
  }

  @Post('promociones/canjear')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async canjearCupon(@Body() dto: any, @Req() req: any) {
    return this.queryService.registrarCanjeCupon(req.user.tenantId, dto.codigo);
  }

  @Delete('promociones/:id')
  @Roles(Rol.ROL_ADMIN)
  async eliminarPromocion(@Param('id') id: string, @Req() req: any) {
    return this.queryService.eliminarPromocion(id, req.user.tenantId);
  }

  @Get(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async obtenerCliente(@Param('id') id: string) {
    return this.queryService.obtenerCliente(id);
  }


  @Get(':id/historial-credito')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async obtenerHistorialCredito(@Param('id') id: string) {
    return this.queryService.obtenerHistorialCambiosNivel(id);
  }

  @Get(':id/validar-credito')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async validarCredito(
    @Param('id') id: string,
    @Query('monto', ParseFloatPipe) monto: number,
  ) {
    return this.queryService.validarCapacidadCrediticia(id, monto);
  }

  // ══════════════════════════════
  // COMMANDS
  // ══════════════════════════════

  @Post()
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async registrarCliente(@Body() dto: RegistrarClienteDto, @Req() req: any) {
    if (dto.telefono && !validarTelefonoCelular(dto.telefono)) {
      throw new BadRequestException('El número de celular debe tener exactamente 10 dígitos y comenzar con 09 (ej. 0991234567).');
    }
    if (dto.cedula && !validarCedula(dto.cedula)) {
      throw new BadRequestException('La cédula ecuatoriana ingresada no es válida (10 dígitos con verificador correcto).');
    }
    if (dto.ruc && !validarRuc(dto.ruc)) {
      throw new BadRequestException('El RUC ecuatoriano ingresado no es válido (13 dígitos, terminado en 001).');
    }

    const telNormalizado = normalizarTelefonoCelular(dto.telefono);

    const command = new RegistrarClienteCommand(
      dto.nombre.trim(),
      dto.apellido.trim(),
      telNormalizado,
      dto.email?.trim() ?? null,
      dto.ruc?.trim() ?? null,
      dto.cedula?.trim() ?? null,
      dto.direccion?.trim() ?? null,
      dto.notas?.trim() ?? null,
      req.user.tenantId,
    );
    const id = await this.registrarClienteHandler.execute(command);
    return { id, message: 'Cliente registrado exitosamente' };
  }

  @Patch(':id')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  async actualizarCliente(
    @Param('id') id: string,
    @Body() dto: ActualizarClienteDto,
  ) {
    if (dto.telefono && !validarTelefonoCelular(dto.telefono)) {
      throw new BadRequestException('El número de celular debe tener exactamente 10 dígitos y comenzar con 09 (ej. 0991234567).');
    }
    if (dto.cedula && !validarCedula(dto.cedula)) {
      throw new BadRequestException('La cédula ecuatoriana ingresada no es válida (10 dígitos con verificador correcto).');
    }
    if (dto.ruc && !validarRuc(dto.ruc)) {
      throw new BadRequestException('El RUC ecuatoriano ingresado no es válido (13 dígitos, terminado en 001).');
    }

    const telNormalizado = dto.telefono ? normalizarTelefonoCelular(dto.telefono) : dto.telefono;

    const command = new ActualizarClienteCommand(
      id,
      dto.nombre.trim(),
      dto.apellido.trim(),
      telNormalizado,
      dto.email?.trim() ?? null,
      dto.ruc?.trim() ?? null,
      dto.cedula?.trim() ?? null,
      dto.direccion?.trim() ?? null,
      dto.notas?.trim() ?? null,
    );
    await this.actualizarClienteHandler.execute(command);
    return { message: 'Datos personales de cliente actualizados' };
  }

  @Post(':id/ajustar-nivel')
  @Roles(Rol.ROL_ADMIN)
  async ajustarNivel(
    @Param('id') id: string,
    @Body() dto: AjustarNivelDto,
    @Req() req: any,
  ) {
    const command = new AjustarNivelManualmenteCommand(
      id,
      dto.nuevoNivel,
      req.user.sub,
      req.user.rol,
    );
    await this.ajustarNivelManualmenteHandler.execute(command);
    return { message: 'Nivel de crédito del cliente ajustado manualmente' };
  }
}
