import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { InventarioModule } from './bounded-contexts/inventario/infrastructure/inventario.module';

@Module({
  imports: [
    // Carga las variables de entorno desde .env
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Módulo global: PrismaService + EncryptionService
    SharedModule,

    // Módulos de la aplicación
    AuthModule,
    ConfiguracionModule,

    // Bounded Contexts
    InventarioModule,
  ],
})
export class AppModule {}
