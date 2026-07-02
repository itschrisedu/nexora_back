import { BadRequestException } from '@nestjs/common';

export class StockInsuficienteException extends BadRequestException {
  constructor(productoId: string, tallaId: string, disponible: number, solicitado: number) {
    super(
      `Stock insuficiente para el producto ${productoId} en la talla ${tallaId}. Disponible: ${disponible}, Solicitado: ${solicitado}`,
    );
  }
}
