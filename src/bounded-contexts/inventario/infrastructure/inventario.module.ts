import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../../../auth/auth.module';

// Infrastructure
import { PrismaProductoRepository } from './PrismaProductoRepository';
import { InventarioController } from './inventario.controller';
import { LimpiarReservasExpiradas } from './jobs/LimpiarReservasExpiradas.job';
import { InventarioPedidoListener } from './listeners/inventario-pedido.listener';

// Application — Command Handlers
import { CrearProductoHandler } from '../application/commands/CrearProducto.handler';
import { CambiarPrecioHandler } from '../application/commands/CambiarPrecio.handler';
import { ReservarStockHandler } from '../application/commands/ReservarStock.handler';
import { LiberarReservaHandler } from '../application/commands/LiberarReserva.handler';
import { AumentarStockHandler } from '../application/commands/AumentarStock.handler';
import { DescontarStockHandler } from '../application/commands/DescontarStock.handler';

// Application — Queries
import { InventarioQueryService } from '../application/queries/InventarioQueryService';

@Module({
  imports: [ScheduleModule.forRoot(), AuthModule],
  controllers: [InventarioController],
  providers: [
    // Repository
    {
      provide: 'IProductoRepository',
      useClass: PrismaProductoRepository,
    },

    // Command Handlers
    CrearProductoHandler,
    CambiarPrecioHandler,
    ReservarStockHandler,
    LiberarReservaHandler,
    AumentarStockHandler,
    DescontarStockHandler,

    // Queries
    InventarioQueryService,

    // Jobs
    LimpiarReservasExpiradas,

    // Listeners
    InventarioPedidoListener,
  ],
  exports: [
    'IProductoRepository',
    InventarioQueryService,
    ReservarStockHandler,
    LiberarReservaHandler,
    AumentarStockHandler,
  ],
})
export class InventarioModule {}
