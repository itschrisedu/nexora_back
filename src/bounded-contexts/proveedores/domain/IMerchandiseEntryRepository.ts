import { MerchandiseEntry } from './MerchandiseEntry';

export abstract class IMerchandiseEntryRepository {
  abstract findById(id: string): Promise<MerchandiseEntry | null>;
  abstract findByNumero(numero: number): Promise<MerchandiseEntry | null>;
  abstract save(entry: MerchandiseEntry): Promise<void>;
  abstract listBySupplier(supplierId: string): Promise<MerchandiseEntry[]>;
  abstract listAll(): Promise<MerchandiseEntry[]>;
}
