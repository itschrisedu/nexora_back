import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { DomainException } from '../../../shared/domain/DomainException';
import { SupplierCreadoEvent } from './events/ProveedorEvents';

export class RucInvalidoException extends DomainException {
  constructor(ruc: string) {
    super(`El RUC ${ruc} no es válido. Debe tener 13 dígitos numéricos.`, 'RUC_INVALIDO');
  }
}

export class RucVacioException extends DomainException {
  constructor() {
    super('El RUC no puede estar vacío.', 'RUC_VACIO');
  }
}

export class RazonSocialVaciaException extends DomainException {
  constructor() {
    super('La razón social no puede estar vacía.', 'RAZON_SOCIAL_VACIA');
  }
}

export class Supplier extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private _ruc: string,
    private _razonSocial: string,
    private _contacto: string | null,
    private _direccion: string | null,
    private _email: string | null,
    private _activo: boolean,
    private readonly _createdAt: Date,
  ) {
    super();
  }

  static crear(
    id: string,
    ruc: string,
    razonSocial: string,
    contacto?: string,
    direccion?: string,
    email?: string,
  ): Supplier {
    if (!ruc || ruc.trim() === '') {
      throw new RucVacioException();
    }
    if (!razonSocial || razonSocial.trim() === '') {
      throw new RazonSocialVaciaException();
    }

    const supplier = new Supplier(
      id,
      ruc,
      razonSocial,
      contacto ?? null,
      direccion ?? null,
      email ?? null,
      true,
      new Date(),
    );

    supplier.addDomainEvent(new SupplierCreadoEvent(id, ruc, razonSocial));
    return supplier;
  }

  // Getters
  get id(): string { return this._id; }
  get ruc(): string { return this._ruc; }
  get razonSocial(): string { return this._razonSocial; }
  get contacto(): string | null { return this._contacto; }
  get direccion(): string | null { return this._direccion; }
  get email(): string | null { return this._email; }
  get activo(): boolean { return this._activo; }
  get createdAt(): Date { return this._createdAt; }

  // Métodos de Negocio
  actualizarInfo(
    razonSocial: string,
    contacto?: string,
    direccion?: string,
    email?: string,
  ): void {
    if (!razonSocial || razonSocial.trim() === '') {
      throw new RazonSocialVaciaException();
    }
    this._razonSocial = razonSocial;
    this._contacto = contacto ?? null;
    this._direccion = direccion ?? null;
    this._email = email ?? null;
  }

  desactivar(): void {
    this._activo = false;
  }

  activar(): void {
    this._activo = true;
  }

  static reconstruir(
    id: string,
    ruc: string,
    razonSocial: string,
    contacto: string | null,
    direccion: string | null,
    email: string | null,
    activo: boolean,
    createdAt: Date,
  ): Supplier {
    return new Supplier(id, ruc, razonSocial, contacto, direccion, email, activo, createdAt);
  }
}
