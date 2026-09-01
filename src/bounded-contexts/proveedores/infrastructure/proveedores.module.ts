import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { InventarioModule } from '../../inventario/infrastructure/inventario.module';
import { FinancieroModule } from '../../financiero/infrastructure/financiero.module';

// Infrastructure
import { ProveedoresController } from './proveedores.controller';
import { PrismaSupplierRepository } from './PrismaSupplierRepository';
import { PrismaSupplierOrderRepository } from './PrismaSupplierOrderRepository';
import { PrismaMerchandiseEntryRepository } from './PrismaMerchandiseEntryRepository';

// Application — Command Handlers
import { RegistrarSupplierHandler } from '../application/commands/RegistrarSupplier.handler';
import { CrearSupplierOrderHandler } from '../application/commands/CrearSupplierOrder.handler';
import { ActualizarSupplierOrderHandler } from '../application/commands/ActualizarSupplierOrder.handler';
import { RegistrarMerchandiseEntryHandler } from '../application/commands/RegistrarMerchandiseEntry.handler';
import { RegistrarSupplierPaymentHandler } from '../application/commands/RegistrarSupplierPayment.handler';

// Application — Queries
import { ProveedoresQueryService } from '../application/queries/ProveedoresQueryService';

// Listeners
import { IngresoMercanciaInventarioListener } from './listeners/ingreso-mercancia-inventario.listener';
import { IngresoMercanciaFinancieroListener } from './listeners/ingreso-mercancia-financiero.listener';

@Module({
  imports: [AuthModule, InventarioModule, FinancieroModule],
  controllers: [ProveedoresController],
  providers: [
    // Repositories
    {
      provide: 'ISupplierRepository',
      useClass: PrismaSupplierRepository,
    },
    {
      provide: 'ISupplierOrderRepository',
      useClass: PrismaSupplierOrderRepository,
    },
    {
      provide: 'IMerchandiseEntryRepository',
      useClass: PrismaMerchandiseEntryRepository,
    },

    // Command Handlers
    RegistrarSupplierHandler,
    CrearSupplierOrderHandler,
    ActualizarSupplierOrderHandler,
    RegistrarMerchandiseEntryHandler,
    RegistrarSupplierPaymentHandler,

    // Queries
    ProveedoresQueryService,

    // Listeners
    IngresoMercanciaInventarioListener,
    IngresoMercanciaFinancieroListener,
  ],
  exports: [
    'ISupplierRepository',
    'ISupplierOrderRepository',
    'IMerchandiseEntryRepository',
    ProveedoresQueryService,
  ],
})
export class ProveedoresModule {}
