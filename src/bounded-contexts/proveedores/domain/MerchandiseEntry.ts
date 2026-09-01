import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { DomainException } from '../../../shared/domain/DomainException';
import { MerchandiseEntryRegistradaEvent } from './events/ProveedorEvents';

export interface MerchandiseEntryLineProps {
  id: string;
  productId: string;
  tallaId: string;
  cantidadIngresada: number;
  cantidadEsperada?: number;
  diferencia?: number;
  precioCosto: number;
  subtotal: number;
  observacionLinea?: string;
}

export class MerchandiseEntrySinLineasException extends DomainException {
  constructor() {
    super('Una entrada de mercancía debe tener al menos una línea.', 'ENTRADA_SIN_LINEAS');
  }
}

export class CantidadIngresadaInvalidaException extends DomainException {
  constructor() {
    super('La cantidad ingresada debe ser mayor a 0.', 'CANTIDAD_INVALIDA');
  }
}

export class PrecioCostoEntryInvalidoException extends DomainException {
  constructor() {
    super('El precio de costo debe ser mayor a 0.', 'PRECIO_COSTO_INVALIDO');
  }
}

export class MerchandiseEntry extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private readonly _numero: number,
    private readonly _supplierOrderId: string | null,
    private readonly _supplierId: string,
    private readonly _total: number,
    private readonly _lines: MerchandiseEntryLineProps[],
    private readonly _observaciones?: string,
    private readonly _estado: string = 'COMPLETA',
    private readonly _fechaIngreso: Date = new Date(),
  ) {
    super();
  }

  static crear(
    id: string,
    numero: number,
    supplierId: string,
    lines: Array<{
      id: string;
      productId: string;
      tallaId: string;
      cantidadIngresada: number;
      cantidadEsperada?: number;
      diferencia?: number;
      precioCosto: number;
      observacionLinea?: string;
    }>,
    supplierOrderId?: string,
    observaciones?: string,
    estado: string = 'COMPLETA',
  ): MerchandiseEntry {
    if (lines.length === 0) {
      throw new MerchandiseEntrySinLineasException();
    }

    const entryLines: MerchandiseEntryLineProps[] = lines.map((l) => {
      if (l.cantidadIngresada <= 0) {
        throw new CantidadIngresadaInvalidaException();
      }
      if (l.precioCosto <= 0) {
        throw new PrecioCostoEntryInvalidoException();
      }
      return {
        id: l.id,
        productId: l.productId,
        tallaId: l.tallaId,
        cantidadIngresada: l.cantidadIngresada,
        cantidadEsperada: l.cantidadEsperada,
        diferencia: l.diferencia,
        precioCosto: l.precioCosto,
        subtotal: l.cantidadIngresada * l.precioCosto,
        observacionLinea: l.observacionLinea,
      };
    });

    const total = entryLines.reduce((acc, curr) => acc + curr.subtotal, 0);

    const entry = new MerchandiseEntry(
      id,
      numero,
      supplierOrderId ?? null,
      supplierId,
      total,
      entryLines,
      observaciones,
      estado,
      new Date(),
    );

    entry.addDomainEvent(
      new MerchandiseEntryRegistradaEvent(
        id,
        numero,
        supplierId,
        total,
        entryLines.map((el) => ({
          productId: el.productId,
          tallaId: el.tallaId,
          cantidadIngresada: el.cantidadIngresada,
          precioCosto: el.precioCosto,
        })),
        supplierOrderId,
      ),
    );

    return entry;
  }

  // Getters
  get id(): string { return this._id; }
  get numero(): number { return this._numero; }
  get supplierOrderId(): string | null { return this._supplierOrderId; }
  get supplierId(): string { return this._supplierId; }
  get total(): number { return this._total; }
  get lines(): ReadonlyArray<MerchandiseEntryLineProps> { return this._lines; }
  get observaciones(): string | undefined { return this._observaciones; }
  get estado(): string { return this._estado; }
  get fechaIngreso(): Date { return this._fechaIngreso; }

  static reconstruir(
    id: string,
    numero: number,
    supplierOrderId: string | null,
    supplierId: string,
    total: number,
    lines: MerchandiseEntryLineProps[],
    observaciones?: string,
    estado: string = 'COMPLETA',
    fechaIngreso: Date = new Date(),
  ): MerchandiseEntry {
    return new MerchandiseEntry(id, numero, supplierOrderId, supplierId, total, lines, observaciones, estado, fechaIngreso);
  }
}
