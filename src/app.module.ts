import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { InventarioModule } from './bounded-contexts/inventario/infrastructure/inventario.module';
import { ClientesModule } from './bounded-contexts/clientes/infrastructure/clientes.module';
import { ComercialModule } from './bounded-contexts/comercial/infrastructure/comercial.module';
import { FinancieroModule } from './bounded-contexts/financiero/infrastructure/financiero.module';
import { ProveedoresModule } from './bounded-contexts/proveedores/infrastructure/proveedores.module';
import { NotificacionesModule } from './bounded-contexts/notificaciones/infrastructure/notificaciones.module';
import { FacturacionSriModule } from './bounded-contexts/facturacion-sri/infrastructure/facturacion-sri.module';
import { AuditModule } from './shared/infrastructure/audit/audit.module';
import { ReportesModule } from './bounded-contexts/reportes/infrastructure/reportes.module';

@Module({
  imports: [
    // Carga las variables de entorno desde .env
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Habilitar Event Emitter para arquitectura dirigida por eventos
    EventEmitterModule.forRoot(),

    // Módulo global: PrismaService + EncryptionService
    SharedModule,


    // Módulos de la aplicación
    AuthModule,
    ConfiguracionModule,

    // Bounded Contexts
    InventarioModule,
    ClientesModule,
    ComercialModule,
    FinancieroModule,
    ProveedoresModule,
    NotificacionesModule,
    FacturacionSriModule,
    AuditModule,
    ReportesModule,
  ],
})
export class AppModule {}



