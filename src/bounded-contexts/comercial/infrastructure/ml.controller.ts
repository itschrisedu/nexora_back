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
   * POST /ml/prediccion
   * Genera predicción de demanda para el tenant autenticado.
   */
  @Post('prediccion')
  async prediccion(
    @Request() req: any,
    @Body() body: { horizonteDias?: number },
  ) {
    const tenantId = req.user.tenantId;
    return this.mlBridge.obtenerPrediccion(
      tenantId,
      body.horizonteDias ?? 30,
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
