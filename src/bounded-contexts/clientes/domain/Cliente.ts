import { AggregateRoot } from '../../../shared/domain/AggregateRoot';
import { Money } from '../../../shared/domain/Money';
import { NivelCredito } from './value-objects/NivelCredito';
import { ScoreCredito } from './value-objects/ScoreCredito';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';
import {
  ClienteRegistradoEvent,
  NivelCreditoSubioEvent,
  NivelCreditoBajoEvent,
  ClienteDegradadoAContadoEvent,
  NivelAjustadoManualmenteEvent,
  CreditoComprometidoEvent,
  CreditoLiberadoEvent,
} from './events/ClienteEvents';
import {
  CreditoNoPermitidoException,
  PermisoInsuficienteException,
  LimiteCreditoInsuficienteException,
} from './exceptions/ClienteExceptions';

export class Cliente extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private _nombre: string,
    private _apellido: string,
    private _telefono: string,
    private _email: string | null,
    private _ruc: string | null,
    private _cedula: string | null,
    private _direccion: string | null,
    private _notas: string | null,
    private _nivelCredito: NivelCredito,
    private _totalCompras: number,
    private _comprasSinAtraso: number,
    private _atrasoConsecutivo: number,
    private _limiteCredito: Money,
    private _creditoUtilizado: Money,
    private _activo: boolean = true,
  ) {
    super();
  }

  static crear(
    id: string,
    nombre: string,
    apellido: string,
    telefono: string,
    email: string | null,
    ruc: string | null,
    cedula: string | null,
    direccion: string | null,
    notas: string | null,
  ): Cliente {
    const cliente = new Cliente(
      id,
      nombre,
      apellido,
      telefono,
      email,
      ruc,
      cedula,
      direccion,
      notas,
      NivelCredito.sinCredito(),
      0,
      0,
      0,
      Money.create(0),
      Money.create(0),
      true,
    );

    cliente.addDomainEvent(new ClienteRegistradoEvent(id, nombre, apellido));

    return cliente;
  }

  // ── Getters ─────────────────────────────────

  get id(): string {
    return this._id;
  }

  get nombre(): string {
    return this._nombre;
  }

  get apellido(): string {
    return this._apellido;
  }

  get telefono(): string {
    return this._telefono;
  }

  get email(): string | null {
    return this._email;
  }

  get ruc(): string | null {
    return this._ruc;
  }

  get cedula(): string | null {
    return this._cedula;
  }

  get direccion(): string | null {
    return this._direccion;
  }

  get notas(): string | null {
    return this._notas;
  }

  get nivelCredito(): NivelCredito {
    return this._nivelCredito;
  }

  get totalCompras(): number {
    return this._totalCompras;
  }

  get comprasSinAtraso(): number {
    return this._comprasSinAtraso;
  }

  get atrasoConsecutivo(): number {
    return this._atrasoConsecutivo;
  }

  get limiteCredito(): Money {
    return this._limiteCredito;
  }

  get creditoUtilizado(): Money {
    return this._creditoUtilizado;
  }

  get activo(): boolean {
    return this._activo;
  }

  // ── Métodos de Negocio ──────────────────────

  actualizarDatosPersonales(
    nombre: string,
    apellido: string,
    telefono: string,
    email: string | null,
    ruc: string | null,
    cedula: string | null,
    direccion: string | null,
    notas: string | null,
  ): void {
    this._nombre = nombre;
    this._apellido = apellido;
    this._telefono = telefono;
    this._email = email;
    this._ruc = ruc;
    this._cedula = cedula;
    this._direccion = direccion;
    this._notas = notas;
  }

  registrarCompraCompletada(
    monto: Money,
    esCredito: boolean,
    configs: { nivel: PrismaNivelCredito; comprasRequeridas: number; limiteDolares: number }[],
  ): void {
    this._totalCompras += 1;
    this._comprasSinAtraso += 1;
    this._atrasoConsecutivo = 0;

    if (esCredito) {
      this.liberarCredito(monto);
    }

    const score = ScoreCredito.create(
      this._totalCompras,
      this._comprasSinAtraso,
      this._atrasoConsecutivo,
      this._nivelCredito,
    );

    const configsVO = configs.map((c) => ({
      nivel: c.nivel,
      comprasRequeridas: c.comprasRequeridas,
    }));
    const nivelElegible = score.calcularNivelElegible(configsVO);

    if (this._nivelCredito.esMenorQue(nivelElegible)) {
      const nivelAnterior = this._nivelCredito.value;
      this._nivelCredito = nivelElegible;

      const configNivel = configs.find((c) => c.nivel === nivelElegible.value);
      this._limiteCredito = Money.create(configNivel ? configNivel.limiteDolares : 0);

      this.addDomainEvent(
        new NivelCreditoSubioEvent(
          this.id,
          nivelAnterior,
          nivelElegible.value,
          this._totalCompras,
        ),
      );
    }
  }

  registrarAtraso(
    configs: { nivel: PrismaNivelCredito; comprasRequeridas: number; limiteDolares: number }[],
  ): void {
    this._comprasSinAtraso = 0;
    this._atrasoConsecutivo += 1;

    const nivelAnterior = this._nivelCredito.value;

    if (this._atrasoConsecutivo >= 2) {
      this._nivelCredito = NivelCredito.sinCredito();
      this._limiteCredito = Money.create(0);
      this.addDomainEvent(
        new ClienteDegradadoAContadoEvent(this.id, this._atrasoConsecutivo),
      );
    } else {
      const nuevoNivel = this._nivelCredito.nivelInferior();
      this._nivelCredito = nuevoNivel;

      const configNivel = configs.find((c) => c.nivel === nuevoNivel.value);
      this._limiteCredito = Money.create(configNivel ? configNivel.limiteDolares : 0);

      this.addDomainEvent(
        new NivelCreditoBajoEvent(this.id, nivelAnterior, nuevoNivel.value, 'ATRASO'),
      );
    }
  }

  comprometerCredito(monto: Money): void {
    if (this._nivelCredito.value === 'SIN_CREDITO' || this._limiteCredito.amount <= 0) {
      throw new CreditoNoPermitidoException(
        'El cliente está en Nivel 1 (Sin Crédito). Requiere compras de contado o asignación de nivel por el Administrador.',
      );
    }

    const nuevoUtilizado = this._creditoUtilizado.amount + monto.amount;
    if (nuevoUtilizado > this._limiteCredito.amount) {
      const disponible = this._limiteCredito.amount - this._creditoUtilizado.amount;
      throw new LimiteCreditoInsuficienteException(monto.amount, disponible);
    }

    this._creditoUtilizado = Money.create(nuevoUtilizado);
    this.addDomainEvent(
      new CreditoComprometidoEvent(this.id, monto.amount, this._creditoUtilizado.amount),
    );
  }

  liberarCredito(monto: Money): void {
    const nuevoUtilizado = Math.max(0, this._creditoUtilizado.amount - monto.amount);
    this._creditoUtilizado = Money.create(nuevoUtilizado);
    this.addDomainEvent(
      new CreditoLiberadoEvent(this.id, monto.amount, this._creditoUtilizado.amount),
    );
  }

  ajustarNivelManualmente(
    nuevoNivel: NivelCredito,
    adminId: string,
    rol: string,
    configs: { nivel: PrismaNivelCredito; comprasRequeridas: number; limiteDolares: number }[],
  ): void {
    if (rol !== 'ROL_ADMIN') {
      throw new PermisoInsuficienteException(
        'Ajuste manual de nivel de crédito solo permitido para Administrador',
      );
    }

    const nivelAnterior = this._nivelCredito.value;
    this._nivelCredito = nuevoNivel;

    const configNivel = configs.find((c) => c.nivel === nuevoNivel.value);
    this._limiteCredito = Money.create(configNivel ? configNivel.limiteDolares : 0);
    this._atrasoConsecutivo = 0;

    this.addDomainEvent(
      new NivelAjustadoManualmenteEvent(
        this.id,
        nivelAnterior,
        nuevoNivel.value,
        adminId,
      ),
    );
  }

  // ── Reconstrucción ──────────────────────────

  static reconstruir(
    id: string,
    nombre: string,
    apellido: string,
    telefono: string,
    email: string | null,
    ruc: string | null,
    cedula: string | null,
    direccion: string | null,
    notas: string | null,
    nivelCredito: NivelCredito,
    totalCompras: number,
    comprasSinAtraso: number,
    atrasoConsecutivo: number,
    limiteCredito: Money,
    creditoUtilizado: Money,
    activo: boolean,
  ): Cliente {
    return new Cliente(
      id,
      nombre,
      apellido,
      telefono,
      email,
      ruc,
      cedula,
      direccion,
      notas,
      nivelCredito,
      totalCompras,
      comprasSinAtraso,
      atrasoConsecutivo,
      limiteCredito,
      creditoUtilizado,
      activo,
    );
  }
}
