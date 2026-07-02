import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RecuperarContrasenaDto, ResetContrasenaDto } from './dto/auth.dto';

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
   * Aplica nueva contraseña usando el token de recuperación.
   */
  @Post('reset-contrasena')
  @HttpCode(HttpStatus.OK)
  async resetContrasena(@Body() dto: ResetContrasenaDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }
}
