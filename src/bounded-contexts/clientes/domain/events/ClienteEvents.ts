import { DomainEvent } from '../../../../shared/domain/DomainEvent';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

export class ClienteRegistradoEvent extends DomainEvent {
  constructor(
    public readonly clienteId: string,
    public readonly nombre: string,
    public readonly apellido: string,
  ) {
    super('ClienteRegistrado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      clienteId: this.clienteId,
      nombre: this.nombre,
      apellido: this.apellido,
    };
  }
}

export class NivelCreditoSubioEvent extends DomainEvent {
  constructor(
    public readonly clienteId: string,
    public readonly nivelAnterior: PrismaNivelCredito,
    public readonly nivelNuevo: PrismaNivelCredito,
    public readonly totalCompras: number,
  ) {
    super('NivelCreditoSubio');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      clienteId: this.clienteId,
      nivelAnterior: this.nivelAnterior,
      nivelNuevo: this.nivelNuevo,
      totalCompras: this.totalCompras,
    };
  }
}

export class NivelCreditoBajoEvent extends DomainEvent {
  constructor(
    public readonly clienteId: string,
    public readonly nivelAnterior: PrismaNivelCredito,
    public readonly nivelNuevo: PrismaNivelCredito,
    public readonly motivo: string,
  ) {
    super('NivelCreditoBajo');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      clienteId: this.clienteId,
      nivelAnterior: this.nivelAnterior,
      nivelNuevo: this.nivelNuevo,
      motivo: this.motivo,
    };
  }
}

export class ClienteDegradadoAContadoEvent extends DomainEvent {
  constructor(
    public readonly clienteId: string,
    public readonly atrasoConsecutivo: number,
  ) {
    super('ClienteDegradadoAContado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      clienteId: this.clienteId,
      atrasoConsecutivo: this.atrasoConsecutivo,
    };
  }
}

export class NivelAjustadoManualmenteEvent extends DomainEvent {
  constructor(
    public readonly clienteId: string,
    public readonly nivelAnterior: PrismaNivelCredito,
    public readonly nivelNuevo: PrismaNivelCredito,
    public readonly adminId: string,
  ) {
    super('NivelAjustadoManualmente');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      clienteId: this.clienteId,
      nivelAnterior: this.nivelAnterior,
      nivelNuevo: this.nivelNuevo,
      adminId: this.adminId,
    };
  }
}

export class CreditoComprometidoEvent extends DomainEvent {
  constructor(
    public readonly clienteId: string,
    public readonly monto: number,
    public readonly creditoUtilizadoTotal: number,
  ) {
    super('CreditoComprometido');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      clienteId: this.clienteId,
      monto: this.monto,
      creditoUtilizadoTotal: this.creditoUtilizadoTotal,
    };
  }
}

export class CreditoLiberadoEvent extends DomainEvent {
  constructor(
    public readonly clienteId: string,
    public readonly monto: number,
    public readonly creditoUtilizadoTotal: number,
  ) {
    super('CreditoLiberado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      clienteId: this.clienteId,
      monto: this.monto,
      creditoUtilizadoTotal: this.creditoUtilizadoTotal,
    };
  }
}
