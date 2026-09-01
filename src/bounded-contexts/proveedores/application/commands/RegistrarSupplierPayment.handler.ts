import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';

@Injectable()
export class RegistrarSupplierPaymentHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: {
    supplierId: string;
    monto: number;
    metodo: string;
    comprobante?: string;
    banco?: string;
    notas?: string;
    supplierOrderId?: string;
  }): Promise<string> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: command.supplierId },
    });
    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID "${command.supplierId}" no encontrado.`);
    }

    if (command.monto <= 0) {
      throw new BadRequestException('El monto del pago debe ser mayor a cero.');
    }

    const payment = await this.prisma.supplierPayment.create({
      data: {
        id: crypto.randomUUID(),
        supplierId: command.supplierId,
        supplierOrderId: command.supplierOrderId || null,
        monto: command.monto,
        metodo: command.metodo,
        comprobante: command.comprobante || null,
        banco: command.banco || null,
        notas: command.notas || null,
      },
    });

    return payment.id;
  }
}
