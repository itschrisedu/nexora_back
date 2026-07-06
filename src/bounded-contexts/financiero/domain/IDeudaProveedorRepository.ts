import { DeudaProveedor } from './DeudaProveedor';

export abstract class IDeudaProveedorRepository {
  abstract findById(id: string): Promise<DeudaProveedor | null>;
  abstract findByEntradaId(entradaId: string): Promise<DeudaProveedor | null>;
  abstract findBySupplierId(supplierId: string): Promise<DeudaProveedor[]>;
  abstract findPendientes(): Promise<DeudaProveedor[]>;
  abstract findProximasAVencer(diasAntelacion: number): Promise<DeudaProveedor[]>;
  abstract save(deuda: DeudaProveedor): Promise<void>;
  abstract update(deuda: DeudaProveedor): Promise<void>;
}
