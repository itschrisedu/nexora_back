import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';

// Infrastructure
import { PrismaClienteRepository } from './PrismaClienteRepository';
import { ClientesController } from './clientes.controller';

// Application — Command Handlers
import { RegistrarClienteHandler } from '../application/commands/RegistrarCliente.handler';
import { ActualizarClienteHandler } from '../application/commands/ActualizarCliente.handler';
import { RegistrarCompraCompletadaHandler } from '../application/commands/RegistrarCompraCompletada.handler';
import { RegistrarAtrasoHandler } from '../application/commands/RegistrarAtraso.handler';
import { AjustarNivelManualmenteHandler } from '../application/commands/AjustarNivelManualmente.handler';
import { ComprometerCreditoHandler } from '../application/commands/ComprometerCredito.handler';
import { LiberarCreditoHandler } from '../application/commands/LiberarCredito.handler';

// Application — Queries
import { ClientesQueryService } from '../application/queries/ClientesQueryService';

@Module({
  imports: [AuthModule],
  controllers: [ClientesController],
  providers: [
    // Repository
    {
      provide: 'IClienteRepository',
      useClass: PrismaClienteRepository,
    },

    // Command Handlers
    RegistrarClienteHandler,
    ActualizarClienteHandler,
    RegistrarCompraCompletadaHandler,
    RegistrarAtrasoHandler,
    AjustarNivelManualmenteHandler,
    ComprometerCreditoHandler,
    LiberarCreditoHandler,

    // Queries
    ClientesQueryService,
  ],
  exports: [
    'IClienteRepository',
    ClientesQueryService,
    ComprometerCreditoHandler,
    LiberarCreditoHandler,
    RegistrarCompraCompletadaHandler,
    RegistrarAtrasoHandler,
  ],
})
export class ClientesModule {}
