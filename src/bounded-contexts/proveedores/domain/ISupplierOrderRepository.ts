import { SupplierOrder } from './SupplierOrder';

export abstract class ISupplierOrderRepository {
  abstract findById(id: string): Promise<SupplierOrder | null>;
  abstract findByNumero(numero: number): Promise<SupplierOrder | null>;
  abstract save(order: SupplierOrder): Promise<void>;
  abstract update(order: SupplierOrder): Promise<void>;
  abstract listBySupplier(supplierId: string): Promise<SupplierOrder[]>;
  abstract listAll(): Promise<SupplierOrder[]>;
}
