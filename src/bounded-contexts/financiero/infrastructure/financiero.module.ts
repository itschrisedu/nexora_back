import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { ClientesModule } from '../../clientes/infrastructure/clientes.module';

// Infrastructure
import { FinancieroController } from './financiero.controller';
import { DevolucionesController } from './devoluciones.controller';
import { PrismaCobroRepository } from './PrismaCobroRepository';
import { PrismaDeudaProveedorRepository } from './PrismaDeudaProveedorRepository';
import { PdfGeneratorService } from './pdf/pdf-generator.service';

// Listeners
import { PedidoEntregadoFinancieroListener } from './listeners/pedido-entregado-financiero.listener';
import { DeudaSaldadaClientesListener } from './listeners/deuda-saldada-clientes.listener';

// Application — Command Handlers
import { RegistrarAbonoHandler } from '../application/commands/RegistrarAbono.handler';
import { RegistrarPagoProveedorHandler } from '../application/commands/RegistrarPagoProveedor.handler';
import { CrearDeudaProveedorHandler } from '../application/commands/CrearDeudaProveedor.handler';
import { DevolucionesService } from '../application/DevolucionesService';

// Application — Queries
import { FinancieroQueryService } from '../application/queries/FinancieroQueryService';

@Module({
  imports: [AuthModule, ClientesModule],
  controllers: [FinancieroController, DevolucionesController],
  providers: [
    // Repositories
    {
      provide: 'ICobroRepository',
      useClass: PrismaCobroRepository,
    },
    {
      provide: 'IDeudaProveedorRepository',
      useClass: PrismaDeudaProveedorRepository,
    },

    // Infrastructure Services
    PdfGeneratorService,

    // Command Handlers
    RegistrarAbonoHandler,
    RegistrarPagoProveedorHandler,
    CrearDeudaProveedorHandler,

    // Devoluciones
    DevolucionesService,

    // Queries
    FinancieroQueryService,

    // Listeners
    PedidoEntregadoFinancieroListener,
    DeudaSaldadaClientesListener,
  ],
  exports: [
    FinancieroQueryService,
    PdfGeneratorService,
    RegistrarAbonoHandler,
    RegistrarPagoProveedorHandler,
    CrearDeudaProveedorHandler,
    DevolucionesService,
  ],
})
export class FinancieroModule {}
