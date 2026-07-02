import { Global, Module } from '@nestjs/common';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { EncryptionService } from './infrastructure/encryption/encryption.service';

/**
 * SharedModule — Módulo global que provee PrismaService y EncryptionService
 * a todos los módulos de la aplicación sin necesidad de importarlo en cada uno.
 */
@Global()
@Module({
  providers: [PrismaService, EncryptionService],
  exports: [PrismaService, EncryptionService],
})
export class SharedModule {}
