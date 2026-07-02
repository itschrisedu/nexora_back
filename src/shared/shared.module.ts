import { Global, Module } from '@nestjs/common';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { EncryptionService } from './infrastructure/encryption/encryption.service';
import { EventBus } from './infrastructure/event-bus/event-bus.service';

/**
 * SharedModule — Módulo global que provee PrismaService, EncryptionService y EventBus
 * a todos los módulos de la aplicación sin necesidad de importarlo en cada uno.
 */
@Global()
@Module({
  providers: [PrismaService, EncryptionService, EventBus],
  exports: [PrismaService, EncryptionService, EventBus],
})
export class SharedModule {}

