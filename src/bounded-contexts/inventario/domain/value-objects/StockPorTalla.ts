import { ValueObject } from '../../../../shared/domain/ValueObject';
import { StockNegativoException } from '../exceptions/StockNegativoException';
import { ReservaSuperaStockException } from '../exceptions/ReservaSuperaStockException';

interface StockPorTallaProps {
  tallaId: string;
  cantidad: number;          // Stock físico real
  cantidadReservada: number; // Reservas activas
  stockMinimo: number;
  numeroTalla?: number | string;
  modeloNombre?: string;
}

export class StockPorTalla extends ValueObject<StockPorTallaProps> {
  private constructor(props: StockPorTallaProps) {
    super(props);
    this.validarInvariantes();
  }

  static create(
    tallaId: string,
    cantidad: number = 0,
    cantidadReservada: number = 0,
    stockMinimo: number = 0,
    numeroTalla?: number | string,
    modeloNombre?: string,
  ): StockPorTalla {
    return new StockPorTalla({
      tallaId,
      cantidad,
      cantidadReservada,
      stockMinimo,
      numeroTalla,
      modeloNombre,
    });
  }

  get tallaId(): string {
    return this.props.tallaId;
  }

  get cantidad(): number {
    return this.props.cantidad;
  }

  get cantidadReservada(): number {
    return this.props.cantidadReservada;
  }

  get stockMinimo(): number {
    return this.props.stockMinimo;
  }

  get numeroTalla(): number | string | undefined {
    return this.props.numeroTalla;
  }

  get modeloNombre(): string | undefined {
    return this.props.modeloNombre;
  }

  get cantidadDisponible(): number {
    return this.cantidad - this.cantidadReservada;
  }

  // ── Operaciones inmutables ──────────────────

  aumentarFisico(cantidad: number): StockPorTalla {
    if (cantidad < 0) throw new Error('Cantidad debe ser positiva');
    return new StockPorTalla({
      ...this.props,
      cantidad: this.cantidad + cantidad,
    });
  }

  disminuirFisico(cantidad: number): StockPorTalla {
    if (cantidad < 0) throw new Error('Cantidad debe ser positiva');
    const nuevaCantidad = Math.max(0, this.cantidad - cantidad);
    // Si la entrega física consume unidades reservadas, la reserva se reduce al tope de la cantidad física
    const nuevaReserva = Math.min(this.cantidadReservada, nuevaCantidad);
    return new StockPorTalla({
      ...this.props,
      cantidad: nuevaCantidad,
      cantidadReservada: nuevaReserva,
    });
  }

  aumentarReserva(cantidad: number): StockPorTalla {
    if (cantidad < 0) throw new Error('Cantidad debe ser positiva');
    return new StockPorTalla({
      ...this.props,
      cantidadReservada: this.cantidadReservada + cantidad,
    });
  }

  disminuirReserva(cantidad: number): StockPorTalla {
    if (cantidad < 0) throw new Error('Cantidad debe ser positiva');
    const nuevaReserva = Math.max(0, this.cantidadReservada - cantidad);
    return new StockPorTalla({
      ...this.props,
      cantidadReservada: nuevaReserva,
    });
  }

  // ── Validaciones ────────────────────────────

  private validarInvariantes(): void {
    if (this.cantidad < 0) {
      throw new StockNegativoException(
        this.cantidad,
        this.props.modeloNombre,
        this.props.numeroTalla,
      );
    }
    if (this.cantidadReservada < 0) {
      throw new Error('La cantidad reservada no puede ser negativa');
    }
    if (this.cantidadReservada > this.cantidad) {
      throw new ReservaSuperaStockException(
        this.cantidadReservada,
        this.cantidad,
        this.props.modeloNombre,
        this.props.numeroTalla,
      );
    }
    if (this.cantidadDisponible < 0) {
      throw new StockNegativoException(
        this.cantidadDisponible,
        this.props.modeloNombre,
        this.props.numeroTalla,
      );
    }
  }
}
