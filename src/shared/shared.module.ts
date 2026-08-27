import { Global, Module } from '@nestjs/common';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { EncryptionService } from './infrastructure/encryption/encryption.service';
import { EventBus } from './infrastructure/event-bus/event-bus.service';
import { CloudinaryService } from './infrastructure/cloudinary/cloudinary.service';
import { CloudinaryController } from './infrastructure/cloudinary/cloudinary.controller';

/**
 * SharedModule — Módulo global que provee PrismaService, EncryptionService, EventBus
 * y CloudinaryService a todos los módulos de la aplicación.
 */
@Global()
@Module({
  controllers: [CloudinaryController],
  providers: [PrismaService, EncryptionService, EventBus, CloudinaryService],
  exports: [PrismaService, EncryptionService, EventBus, CloudinaryService],
})
export class SharedModule {}
