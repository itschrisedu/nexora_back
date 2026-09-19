import { BadRequestException } from '@nestjs/common';

export class StockInsuficienteException extends BadRequestException {
  constructor(
    productoId: string,
    tallaId: string,
    disponible: number,
    solicitado: number,
    modelo?: string,
    talla?: number | string,
  ) {
    const nombre = modelo ? `"${modelo}"` : `ID "${productoId}"`;
    const tallaInfo = talla ? ` (Talla ${talla})` : ` en talla "${tallaId}"`;
    super(
      `Stock insuficiente para el modelo ${nombre}${tallaInfo}. Disponible: ${disponible}, Solicitado: ${solicitado}`,
    );
  }
}
