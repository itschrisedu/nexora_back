import { Supplier } from './Supplier';

export abstract class ISupplierRepository {
  abstract findById(id: string): Promise<Supplier | null>;
  abstract findByRuc(ruc: string): Promise<Supplier | null>;
  abstract save(supplier: Supplier, tenantId?: string): Promise<void>;
  abstract update(supplier: Supplier): Promise<void>;
  abstract listAll(): Promise<Supplier[]>;
}
