import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ISupplierRepository } from '../../domain/ISupplierRepository';
import { ActualizarSupplierCommand } from './ActualizarSupplier.command';
import {
  formatearNombres,
  formatearTelefono,
  formatearEmail,
  formatearDireccion,
  validarEmailEstricto,
} from '../../../../shared/utils/text-formatters';

@Injectable()
export class ActualizarSupplierHandler {
  constructor(
    @Inject('ISupplierRepository')
    private readonly supplierRepository: ISupplierRepository,
  ) {}

  async execute(command: ActualizarSupplierCommand): Promise<void> {
    const supplier = await this.supplierRepository.findById(command.id);
    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID "${command.id}" no encontrado.`);
    }

    if (command.email && command.email.trim() !== '') {
      const emailValidation = validarEmailEstricto(command.email);
      if (!emailValidation.valido) {
        throw new BadRequestException(emailValidation.mensaje);
      }
    }

    const razonSocialFinal = command.razonSocial !== undefined ? (command.razonSocial ? command.razonSocial.trim() : supplier.razonSocial) : supplier.razonSocial;
    const contactoFinal = command.contacto !== undefined ? (command.contacto && command.contacto.trim() ? (formatearTelefono(command.contacto) || command.contacto.trim()) : null) : supplier.contacto;
    const direccionFinal = command.direccion !== undefined ? (command.direccion && command.direccion.trim() ? formatearDireccion(command.direccion) : null) : supplier.direccion;
    const emailFinal = command.email !== undefined ? (command.email && command.email.trim() ? formatearEmail(command.email) : null) : supplier.email;

    supplier.actualizarInfo(
      razonSocialFinal,
      contactoFinal ?? undefined,
      direccionFinal ?? undefined,
      emailFinal ?? undefined,
    );

    if (command.activo !== undefined) {
      if (command.activo) {
        supplier.activar();
      } else {
        supplier.desactivar();
      }
    }

    await this.supplierRepository.update(supplier);
  }
}
