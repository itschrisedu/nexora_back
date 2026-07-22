import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Get,
  Patch,
  Param,
  Logger,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RecuperarContrasenaDto, ResetContrasenaDto, CrearUsuarioDto } from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/login
   * Autentica al usuario y retorna access + refresh tokens.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /**
   * POST /auth/refresh
   * Genera un nuevo access token a partir de un refresh token válido.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  /**
   * POST /auth/logout
   * Revoca el refresh token del usuario.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body('refreshToken') refreshToken: string) {
    await this.authService.logout(refreshToken);
    return { message: 'Sesión cerrada exitosamente' };
  }

  /**
   * POST /auth/recuperar-contrasena
   * Genera un token de recuperación y envía email (cuando se integre Resend).
   */
  @Post('recuperar-contrasena')
  @HttpCode(HttpStatus.OK)
  async recuperarContrasena(@Body() dto: RecuperarContrasenaDto) {
    return this.authService.solicitarRecuperacion(dto.email);
  }

  /**
   * POST /auth/reset-contrasena
   * Para nueva contraseña usando el token de recuperación.
   */
  @Post('reset-contrasena')
  @HttpCode(HttpStatus.OK)
  async resetContrasena(@Body() dto: ResetContrasenaDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // ══════════════════════════════════════════
  // GESTIÓN DE PERSONAL (ADMIN / SUPER ADMIN)
  // ══════════════════════════════════════════

  @Get('usuarios')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async listarUsuarios(@Req() req: any) {
    return this.authService.listUsers(req.user);
  }

  @Post('usuarios')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async crearUsuario(@Body() dto: CrearUsuarioDto, @Req() req: any) {
    const user = await this.authService.createUser(dto.email, dto.nombre, dto.rol, dto.password, req.user, dto.tenantId);
    return { ok: true, user, message: 'Usuario registrado correctamente.' };
  }

  @Patch('usuarios/:id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async toggleUsuario(@Param('id') id: string) {
    const user = await this.authService.toggleUserActive(id);
    return { ok: true, user, message: 'Estado del usuario actualizado.' };
  }
}
