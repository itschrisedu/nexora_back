import { ActualizarSupplierHandler } from '../../../src/bounded-contexts/proveedores/application/commands/ActualizarSupplier.handler';
import { ActualizarSupplierCommand } from '../../../src/bounded-contexts/proveedores/application/commands/ActualizarSupplier.command';
import { Supplier } from '../../../src/bounded-contexts/proveedores/domain/Supplier';
import { ISupplierRepository } from '../../../src/bounded-contexts/proveedores/domain/ISupplierRepository';

describe('ActualizarSupplierHandler Unit Tests', () => {
  let handler: ActualizarSupplierHandler;
  let mockSupplierRepo: jest.Mocked<ISupplierRepository>;
  let existingSupplier: Supplier;

  beforeEach(() => {
    existingSupplier = Supplier.crear(
      'sup-123',
      '1801234567001',
      'Curtiduría Central',
      '0991112222',
      'Calle de las Curtiembres',
      'contacto@curtiduria.com',
    );

    mockSupplierRepo = {
      findById: jest.fn().mockResolvedValue(existingSupplier),
      findByRuc: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockImplementation(async (s: Supplier) => {
        existingSupplier = s;
      }),
      listAll: jest.fn().mockResolvedValue([existingSupplier]),
    } as any;

    handler = new ActualizarSupplierHandler(mockSupplierRepo);
  });

  it('debe actualizar teléfono celular sin borrar dígitos ni aplicar filtros alfabéticos', async () => {
    const cmd = new ActualizarSupplierCommand(
      'sup-123',
      'Curtiduría Central Modificada',
      '0987654321',
      'Av. Cevallos 100',
      'nuevo@curtiduria.com',
    );

    await handler.execute(cmd);

    expect(mockSupplierRepo.update).toHaveBeenCalled();
    expect(existingSupplier.contacto).toBe('0987654321');
    expect(existingSupplier.direccion).toBe('Av. Cevallos 100');
    expect(existingSupplier.email).toBe('nuevo@curtiduria.com');
  });

  it('debe permitir borrar el correo electrónico si se envía vacío', async () => {
    const cmd = new ActualizarSupplierCommand(
      'sup-123',
      'Curtiduría Central',
      '0991112222',
      'Calle de las Curtiembres',
      '', // Vacío para eliminar correo de prueba
    );

    await handler.execute(cmd);

    expect(mockSupplierRepo.update).toHaveBeenCalled();
    expect(existingSupplier.email).toBeNull();
  });

  it('debe permitir borrar el teléfono si se envía vacío', async () => {
    const cmd = new ActualizarSupplierCommand(
      'sup-123',
      'Curtiduría Central',
      '',
    );

    await handler.execute(cmd);

    expect(mockSupplierRepo.update).toHaveBeenCalled();
    expect(existingSupplier.contacto).toBeNull();
  });
});
