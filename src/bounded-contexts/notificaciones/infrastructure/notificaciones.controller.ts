import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/guards/roles.decorator';
import { Rol } from '@prisma/client';
import { NotificacionesQueryService } from '../application/queries/NotificacionesQueryService';
import type { EnviarRecordatorioDto } from '../application/queries/NotificacionesQueryService';
import { CobrosVencimientoCron } from './cron/cobros-vencimiento.cron';

@Controller('notificaciones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificacionesController {
  constructor(
    private readonly queryService: NotificacionesQueryService,
    private readonly cobrosCron: CobrosVencimientoCron,
  ) {}

  /**
   * Resumen y conteo de alertas activas para el badge y drawer de notificaciones.
   */
  @Get('resumen')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN)
  obtenerResumen(@Req() req: any, @Query('sucursalId') sucursalId?: string) {
    const isSuperAdmin = req.user.rol === Rol.ROL_SUPER_ADMIN;
    const tenantId = isSuperAdmin
      ? (sucursalId && sucursalId !== 'TODAS' ? sucursalId : null)
      : (sucursalId && sucursalId !== 'TODAS' ? sucursalId : req.user.tenantId);

    return this.queryService.obtenerResumen(tenantId);
  }

  /**
   * Historial de notificaciones despachadas / bitácora de mensajes.
   */
  @Get('historial')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  obtenerHistorial() {
    return this.queryService.obtenerHistorial();
  }

  /**
   * Generación y envío de recordatorios de cobro a clientes (WhatsApp / Email).
   */
  @Post('recordatorio-cobro')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
  enviarRecordatorio(@Body() dto: EnviarRecordatorioDto, @Req() req: any) {
    return this.queryService.enviarRecordatorioCobro(dto, req.user?.sub);
  }

  /**
   * Envío automático de comprobantes oficiales por correo electrónico en segundo plano.
   */
  @Post('email-comprobante')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR, Rol.ROL_SUPER_ADMIN, Rol.ROL_BODEGUERO)
  async enviarEmailComprobante(
    @Body()
    body: {
      destinatario: string;
      asunto: string;
      tipo: 'ABONO' | 'PEDIDO' | 'ENTREGA' | 'DEVOLUCION' | 'COMPRA' | 'GENERAL';
      cuerpoHtml?: string;
      detalles?: any;
    },
  ) {
    return this.queryService.enviarEmailComprobante(body);
  }

  /**
   * Disparo manual de verificación de cobros por vencer / vencidos.
   */
  @Post('ejecutar-cron-cobros')
  @Roles(Rol.ROL_ADMIN, Rol.ROL_SUPER_ADMIN)
  async ejecutarCron() {
    await this.cobrosCron.handleCobrosVencimiento();
    return { ok: true, message: 'Revisión y emisión de eventos de cobros ejecutada exitosamente' };
  }
}
