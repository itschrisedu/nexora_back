import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { ClientesModule } from '../../clientes/infrastructure/clientes.module';
import { InventarioModule } from '../../inventario/infrastructure/inventario.module';

// Infrastructure Repositories & Controller
import { PrismaPedidoRepository } from './PrismaPedidoRepository';
import { PrismaOrderQueueRepository } from './PrismaOrderQueueRepository';
import { PedidosController } from './pedidos.controller';

// Command Handlers
import { CrearPedidoHandler } from '../application/commands/CrearPedido.handler';
import { IniciarPreparacionHandler } from '../application/commands/IniciarPreparacion.handler';
import { MarcarEnTransitoHandler } from '../application/commands/MarcarEnTransito.handler';
import { CancelarPedidoHandler } from '../application/commands/CancelarPedido.handler';
import { ActivarPedidoEnColaHandler } from '../application/commands/ActivarPedidoEnCola.handler';

// Query Services
import { ComercialQueryService } from '../application/queries/ComercialQueryService';

@Module({
  imports: [AuthModule, ClientesModule, InventarioModule],
  controllers: [PedidosController],
  providers: [
    // Repositories
    {
      provide: 'IPedidoRepository',
      useClass: PrismaPedidoRepository,
    },
    {
      provide: 'IOrderQueueRepository',
      useClass: PrismaOrderQueueRepository,
    },

    // Handlers
    CrearPedidoHandler,
    IniciarPreparacionHandler,
    MarcarEnTransitoHandler,
    CancelarPedidoHandler,
    ActivarPedidoEnColaHandler,

    // Queries
    ComercialQueryService,
  ],
  exports: [
    'IPedidoRepository',
    'IOrderQueueRepository',
    ComercialQueryService,
    ActivarPedidoEnColaHandler,
  ],
})
export class ComercialModule {}
