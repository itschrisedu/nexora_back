import { Cliente } from './Cliente';

export interface ClienteFilters {
  q?: string;
  nivelCredito?: string;
  activo?: boolean;
}

export abstract class IClienteRepository {
  abstract findById(id: string): Promise<Cliente | null>;
  abstract findByTelefono(telefono: string): Promise<Cliente | null>;
  abstract findAll(filters?: ClienteFilters): Promise<Cliente[]>;
  abstract save(cliente: Cliente, tenantId?: string): Promise<void>;
  abstract update(cliente: Cliente): Promise<void>;
}
