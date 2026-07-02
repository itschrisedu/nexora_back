import { ValueObject } from '../../../../shared/domain/ValueObject';
import { EstadoPedido as PrismaEstadoPedido } from '@prisma/client';
export { EstadoPedido as PrismaEstadoPedido } from '@prisma/client';
import { DomainException } from '../../../../shared/domain/DomainException';

export class TransicionEstadoInvalidaException extends DomainException {
  constructor(
    public readonly estadoActual: PrismaEstadoPedido,
    public readonly estadoSolicitado: PrismaEstadoPedido,
    public readonly transicionesPermitidas: string[],
  ) {
    super(
      `Transición de estado inválida: de ${estadoActual} a ${estadoSolicitado}. Permitidos: [${transicionesPermitidas.join(', ')}]`,
      'TRANSICION_ESTADO_INVALIDA',
    );
  }
}

export class EstadoPedido extends ValueObject<{ value: PrismaEstadoPedido }> {
  private static readonly transicionesPermitidas: Record<PrismaEstadoPedido, PrismaEstadoPedido[]> = {
    [PrismaEstadoPedido.EN_ESPERA_STOCK]: [PrismaEstadoPedido.PENDIENTE, PrismaEstadoPedido.CANCELADO],
    [PrismaEstadoPedido.PENDIENTE]: [PrismaEstadoPedido.EN_PREPARACION, PrismaEstadoPedido.CANCELADO],
    [PrismaEstadoPedido.EN_PREPARACION]: [PrismaEstadoPedido.EN_TRANSITO, PrismaEstadoPedido.CANCELADO],
    [PrismaEstadoPedido.EN_TRANSITO]: [PrismaEstadoPedido.MODIFICADO, PrismaEstadoPedido.CANCELADO, PrismaEstadoPedido.ENTREGADO],
    [PrismaEstadoPedido.MODIFICADO]: [PrismaEstadoPedido.ENTREGADO, PrismaEstadoPedido.CANCELADO],
    [PrismaEstadoPedido.CANCELADO]: [],
    [PrismaEstadoPedido.ENTREGADO]: [],
  };

  private constructor(value: PrismaEstadoPedido) {
    super({ value });
  }

  static create(value: PrismaEstadoPedido): EstadoPedido {
    return new EstadoPedido(value);
  }

  get value(): PrismaEstadoPedido {
    return this.props.value;
  }

  transicionarA(nuevoEstado: PrismaEstadoPedido): EstadoPedido {
    const permitidos = EstadoPedido.transicionesPermitidas[this.props.value] || [];
    if (!permitidos.includes(nuevoEstado)) {
      throw new TransicionEstadoInvalidaException(
        this.props.value,
        nuevoEstado,
        permitidos,
      );
    }
    return new EstadoPedido(nuevoEstado);
  }
}
