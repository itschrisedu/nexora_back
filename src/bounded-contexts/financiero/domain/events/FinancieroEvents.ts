import { DomainEvent } from '../../../../shared/domain/DomainEvent';
import { TipoCobro, CobroEstado } from '@prisma/client';

// ══════════════════════════════════════════════
// Eventos del Aggregate COBRO
// ══════════════════════════════════════════════

export class CobroCreadoEvent extends DomainEvent {
  constructor(
    public readonly cobroId: string,
    public readonly saleNoteId: string,
    public readonly clientId: string,
    public readonly montoTotal: number,
    public readonly tipo: TipoCobro,
  ) {
    super('CobroCreado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      cobroId: this.cobroId,
      saleNoteId: this.saleNoteId,
      clientId: this.clientId,
      montoTotal: this.montoTotal,
      tipo: this.tipo,
    };
  }
}

export class AbonoRegistradoEvent extends DomainEvent {
  constructor(
    public readonly cobroId: string,
    public readonly clientId: string,
    public readonly monto: number,
    public readonly saldoPendiente: number,
    public readonly metodo: string,
  ) {
    super('AbonoRegistrado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      cobroId: this.cobroId,
      clientId: this.clientId,
      monto: this.monto,
      saldoPendiente: this.saldoPendiente,
      metodo: this.metodo,
    };
  }
}

export class DeudaSaldadaEvent extends DomainEvent {
  constructor(
    public readonly cobroId: string,
    public readonly clientId: string,
    public readonly montoTotal: number,
    public readonly tipo: TipoCobro,
  ) {
    super('DeudaSaldada');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      cobroId: this.cobroId,
      clientId: this.clientId,
      montoTotal: this.montoTotal,
      tipo: this.tipo,
    };
  }
}

export class CobroVencidoSinPagoEvent extends DomainEvent {
  constructor(
    public readonly cobroId: string,
    public readonly clientId: string,
    public readonly saldoPendiente: number,
    public readonly diasVencido: number,
  ) {
    super('CobroVencidoSinPago');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      cobroId: this.cobroId,
      clientId: this.clientId,
      saldoPendiente: this.saldoPendiente,
      diasVencido: this.diasVencido,
    };
  }
}

export class VencimientoCobroEvent extends DomainEvent {
  constructor(
    public readonly cobroId: string,
    public readonly clientId: string,
    public readonly saldoPendiente: number,
  ) {
    super('VencimientoCobro');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      cobroId: this.cobroId,
      clientId: this.clientId,
      saldoPendiente: this.saldoPendiente,
    };
  }
}

export class NotaVentaGeneradaEvent extends DomainEvent {
  constructor(
    public readonly saleNoteId: string,
    public readonly numero: number,
    public readonly clientId: string,
    public readonly pdfUrl: string | null,
    public readonly cobroId: string,
    public readonly total: number,
  ) {
    super('NotaVentaGenerada');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      saleNoteId: this.saleNoteId,
      numero: this.numero,
      clientId: this.clientId,
      pdfUrl: this.pdfUrl,
      cobroId: this.cobroId,
      total: this.total,
    };
  }
}

// ══════════════════════════════════════════════
// Eventos del Aggregate DEUDA PROVEEDOR
// ══════════════════════════════════════════════

export class DeudaProveedorCreadaEvent extends DomainEvent {
  constructor(
    public readonly deudaId: string,
    public readonly supplierId: string,
    public readonly entradaId: string,
    public readonly montoTotal: number,
    public readonly fechaVencimiento: Date,
  ) {
    super('DeudaProveedorCreada');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      deudaId: this.deudaId,
      supplierId: this.supplierId,
      entradaId: this.entradaId,
      montoTotal: this.montoTotal,
      fechaVencimiento: this.fechaVencimiento,
    };
  }
}

export class PagoProveedorRegistradoEvent extends DomainEvent {
  constructor(
    public readonly deudaId: string,
    public readonly supplierId: string,
    public readonly monto: number,
    public readonly saldoPendiente: number,
  ) {
    super('PagoProveedorRegistrado');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      deudaId: this.deudaId,
      supplierId: this.supplierId,
      monto: this.monto,
      saldoPendiente: this.saldoPendiente,
    };
  }
}

export class DeudaProveedorSaldadaEvent extends DomainEvent {
  constructor(
    public readonly deudaId: string,
    public readonly supplierId: string,
    public readonly montoTotal: number,
  ) {
    super('DeudaProveedorSaldada');
  }

  toPrimitives(): Record<string, unknown> {
    return {
      deudaId: this.deudaId,
      supplierId: this.supplierId,
      montoTotal: this.montoTotal,
    };
  }
}
