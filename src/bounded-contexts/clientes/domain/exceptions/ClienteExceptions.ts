import { DomainException } from '../../../../shared/domain/DomainException';

export class CreditoNoPermitidoException extends DomainException {
  constructor(message = 'El cliente requiere 9 compras de contado antes de acceder a crédito') {
    super(message, 'CREDITO_NO_PERMITIDO');
  }
}

export class PermisoInsuficienteException extends DomainException {
  constructor(message = 'No tiene permisos suficientes para realizar esta acción') {
    super(message, 'PERMISO_INSUFICIENTE');
  }
}

export class LimiteCreditoInsuficienteException extends DomainException {
  constructor(montoSolicitado: number, disponible: number) {
    super(
      `Crédito insuficiente. Monto solicitado: $${montoSolicitado.toFixed(2)}, límite disponible: $${disponible.toFixed(2)}`,
      'LIMITE_CREDITO_INSUFICIENTE',
    );
  }
}
