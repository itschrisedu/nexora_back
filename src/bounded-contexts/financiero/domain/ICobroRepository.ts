import { Cobro } from './Cobro';
import { CobroEstado } from '@prisma/client';

export abstract class ICobroRepository {
  abstract findById(id: string): Promise<Cobro | null>;
  abstract findBySaleNoteId(saleNoteId: string): Promise<Cobro | null>;
  abstract findByClientId(clientId: string): Promise<Cobro[]>;
  abstract findVencidos(): Promise<Cobro[]>;
  abstract findProximosAVencer(diasAntelacion: number): Promise<Cobro[]>;
  abstract save(cobro: Cobro): Promise<void>;
  abstract update(cobro: Cobro): Promise<void>;
}
