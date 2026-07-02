import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

export class AjustarNivelManualmenteCommand {
  constructor(
    public readonly clienteId: string,
    public readonly nuevoNivel: PrismaNivelCredito,
    public readonly adminId: string,
    public readonly rol: string,
  ) {}
}
