import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { MlBridgeService } from '../application/MlBridgeService';

@Controller('ml')
@UseGuards(JwtAuthGuard)
export class MlController {
  constructor(private readonly mlBridge: MlBridgeService) {}

  /**
   * GET /ml/prediccion
   * Genera predicción de demanda para el tenant autenticado mediante query params.
   */
  @Get('prediccion')
  async obtenerPrediccionGet(
    @Request() req: any,
    @Query('dias') dias?: string,
    @Query('temporada') temporada?: string,
    @Query('colorExacto') colorExacto?: string,
    @Query('color') color?: string,
  ) {
    const tenantId = req.user.tenantId;
    const horizonte = dias ? parseInt(dias, 10) : 30;
    const isColorExacto = colorExacto === undefined ? true : colorExacto === 'true';
    return this.mlBridge.obtenerPrediccion(
      tenantId,
      horizonte,
      temporada || 'REGULAR',
      isColorExacto,
      color,
    );
  }

  /**
   * POST /ml/prediccion
   * Genera predicción de demanda para el tenant autenticado.
   */
  @Post('prediccion')
  async prediccion(
    @Request() req: any,
    @Body()
    body: {
      horizonteDias?: number;
      temporada?: string;
      colorExacto?: boolean;
      color?: string;
    },
  ) {
    const tenantId = req.user.tenantId;
    return this.mlBridge.obtenerPrediccion(
      tenantId,
      body.horizonteDias ?? 30,
      body.temporada ?? 'REGULAR',
      body.colorExacto ?? true,
      body.color,
    );
  }

  /**
   * POST /ml/reentrenamiento
   * Fuerza re-entrenamiento del modelo ML.
   */
  @Post('reentrenamiento')
  async reentrenar(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.mlBridge.forzarReentrenamiento(tenantId);
  }

  /**
   * GET /ml/estado
   * Consulta el estado del modelo ML.
   */
  @Get('estado')
  async estado(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.mlBridge.estadoModelo(tenantId);
  }
}
