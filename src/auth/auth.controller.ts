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
  BadRequestException,
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
   * Si existe sesión previa activa y no se fuerza, retorna status de conflicto de sesión.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto & { forceTransfer?: boolean }) {
    return this.authService.login(dto.email, dto.password, dto.forceTransfer);
  }

  /**
   * POST /auth/request-session-otp
   * Emite un código OTP de 4 dígitos para transferir la sesión activa.
   */
  @Post('request-session-otp')
  @HttpCode(HttpStatus.OK)
  async requestSessionOtp(@Body() body: { email: string; password?: string }) {
    if (!body?.email) {
      throw new BadRequestException('El correo electrónico es obligatorio.');
    }
    return this.authService.requestSessionTransferOtp(body.email, body.password);
  }

  /**
   * POST /auth/verify-session-otp
   * Valida el código OTP de 4 dígitos y completa el inicio de sesión.
   */
  @Post('verify-session-otp')
  @HttpCode(HttpStatus.OK)
  async verifySessionOtp(@Body() body: { email: string; otp: string }) {
    if (!body?.email || !body?.otp) {
      throw new BadRequestException('El correo y el código de verificación son requeridos.');
    }
    return this.authService.verifySessionOtp(body.email, body.otp);
  }

  /**
   * POST /auth/request-unlock-otp
   * Emite un código OTP para desbloqueo universal de cuenta (Admin y Super Admin).
   */
  @Post('request-unlock-otp')
  @HttpCode(HttpStatus.OK)
  async requestUnlockOtp(@Body() body: { email: string }) {
    if (!body?.email) {
      throw new BadRequestException('El correo electrónico es obligatorio.');
    }
    return this.authService.requestUnlockOtp(body.email);
  }

  /**
   * POST /auth/verify-unlock-otp
   * Valida el código OTP de desbloqueo y restablece el acceso de inmediato.
   */
  @Post('verify-unlock-otp')
  @HttpCode(HttpStatus.OK)
  async verifyUnlockOtp(@Body() body: { email: string; otp: string; newPassword?: string }) {
    if (!body?.email || !body?.otp) {
      throw new BadRequestException('El correo y el código de verificación son requeridos.');
    }
    return this.authService.verifyUnlockOtp(body.email, body.otp, body.newPassword);
  }

  /**
   * POST /auth/refresh
   * Genera un nuevo access token a partir de un refresh token válido.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refreshToken?: string; token?: string }) {
    const token = body?.refreshToken || body?.token;
    if (!token) {
      throw new BadRequestException('El refresh token es obligatorio.');
    }
    return this.authService.refreshToken(token);
  }

  /**
   * POST /auth/logout
   * Revoca el refresh token y libera la sesión activa del usuario.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: { refreshToken?: string; userId?: string }) {
    await this.authService.logout(body?.refreshToken, body?.userId);
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
    const user = await this.authService.createUser(
      dto.email,
      dto.nombre,
      dto.rol,
      dto.password,
      req.user,
      dto.tenantId,
      dto.permiteCambiarPrecio,
    );
    return { ok: true, user, message: 'Usuario registrado correctamente.' };
  }

  @Patch('usuarios/:id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async toggleUsuario(@Param('id') id: string) {
    const user = await this.authService.toggleUserActive(id);
    return { ok: true, user, message: 'Estado del usuario actualizado.' };
  }

  @Patch('usuarios/:id/toggle-permiso-precio')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async togglePermisoPrecio(@Param('id') id: string) {
    const user = await this.authService.toggleUserPermisoPrecio(id);
    return { ok: true, user, message: 'Permiso de modificación de precios actualizado.' };
  }

  @Patch('usuarios/:id/unlock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async unlockUser(@Param('id') id: string) {
    const user = await this.authService.unlockUser(id);
    return { ok: true, user, message: 'Cuenta desbloqueada exitosamente.' };
  }

  // ══════════════════════════════════════════
  // FASE E8: TÉRMINOS LEGALES Y CONSENTIMIENTO GPS
  // ══════════════════════════════════════════

  @Post('accept-terms')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async acceptTerms(@Body('version') version: string, @Req() req: any) {
    return this.authService.acceptTerms(req.user.id, version || '1.0');
  }

  @Post('accept-gps')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async acceptGps(@Req() req: any) {
    return this.authService.acceptGpsConsent(req.user.id);
  }

  @Get('terms-status')
  @UseGuards(JwtAuthGuard)
  async getTermsStatus(@Req() req: any) {
    return this.authService.getTermsStatus(req.user.id);
  }
}
