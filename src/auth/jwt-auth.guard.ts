import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JwtAuthGuard — Guard que protege endpoints requiriendo un access token válido.
 * Uso: @UseGuards(JwtAuthGuard) en el controller o endpoint.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
