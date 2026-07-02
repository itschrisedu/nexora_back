import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Prefijo global de API
  app.setGlobalPrefix('api');

  // Validación global con class-validator
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Elimina propiedades no declaradas en el DTO
      forbidNonWhitelisted: true, // Lanza error si llegan propiedades no esperadas
      transform: true,           // Transforma payloads al tipo del DTO
    }),
  );

  // Filtro global de excepciones
  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS — permite conexiones desde el frontend
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`🚀 NEXORA Backend corriendo en http://localhost:${port}/api`);
}

bootstrap();
