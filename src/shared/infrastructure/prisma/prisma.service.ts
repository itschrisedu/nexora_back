import '../dns-fallback';
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';

/**
 * PrismaService — Wrapper de PrismaClient para NestJS (Prisma 7).
 * Usa driver adapter @prisma/adapter-pg para conectar a PostgreSQL.
 */
@Injectable()
// Mapea la base de datos PostgreSQL utilizando Prisma Client.
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conexión a PostgreSQL establecida');
    try {
      await this.$executeRawUnsafe(
        'ALTER TABLE "business_configs" ADD COLUMN IF NOT EXISTS "sriRegimen" TEXT DEFAULT \'RIMPE_POPULAR\';'
      );
      await this.$executeRawUnsafe(
        'ALTER TABLE "business_configs" ADD COLUMN IF NOT EXISTS "sriRazonSocial" TEXT;'
      );
    } catch (e: any) {
      this.logger.warn(`Error en auto-migración de columnas: ${e.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Conexión a PostgreSQL cerrada');
  }
}
