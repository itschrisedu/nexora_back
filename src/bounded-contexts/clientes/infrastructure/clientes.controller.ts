import {
  Body,
  Controller,
  Get,
  Param,
  ParseFloatPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
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
  async buscarClientes(@Query() query: BuscarClientesDto) {
    return this.queryService.buscarClientes(query);
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
  async registrarCliente(@Body() dto: RegistrarClienteDto) {
    const command = new RegistrarClienteCommand(
      dto.nombre,
      dto.apellido,
      dto.telefono,
      dto.email ?? null,
      dto.ruc ?? null,
      dto.cedula ?? null,
      dto.direccion ?? null,
      dto.notas ?? null,
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
    const command = new ActualizarClienteCommand(
      id,
      dto.nombre,
      dto.apellido,
      dto.telefono,
      dto.email ?? null,
      dto.ruc ?? null,
      dto.cedula ?? null,
      dto.direccion ?? null,
      dto.notas ?? null,
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
