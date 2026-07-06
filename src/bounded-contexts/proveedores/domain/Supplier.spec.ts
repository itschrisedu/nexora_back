import { Supplier, RucVacioException, RazonSocialVaciaException } from './Supplier';

describe('Supplier Aggregate Root', () => {
  const id = 'sup-1';
  const ruc = '0999999999001';
  const razonSocial = 'Calzado del Astillero S.A.';

  describe('crear', () => {
    it('debe instanciarse correctamente con datos válidos', () => {
      const supplier = Supplier.crear(id, ruc, razonSocial, 'Juan Pérez', 'Av. Malecón 100', 'juan@astillero.com');

      expect(supplier.id).toBe(id);
      expect(supplier.ruc).toBe(ruc);
      expect(supplier.razonSocial).toBe(razonSocial);
      expect(supplier.contacto).toBe('Juan Pérez');
      expect(supplier.direccion).toBe('Av. Malecón 100');
      expect(supplier.email).toBe('juan@astillero.com');
      expect(supplier.activo).toBe(true);

      const events = supplier.domainEvents;
      expect(events.some((e) => e.eventName === 'SupplierCreado')).toBe(true);
    });

    it('debe lanzar RucVacioException si el RUC está vacío', () => {
      expect(() => {
        Supplier.crear(id, '', razonSocial);
      }).toThrow(RucVacioException);
    });

    it('debe lanzar RazonSocialVaciaException si la razón social está vacía', () => {
      expect(() => {
        Supplier.crear(id, ruc, '   ');
      }).toThrow(RazonSocialVaciaException);
    });
  });

  describe('actualizarInfo', () => {
    it('debe actualizar la información del proveedor de forma correcta', () => {
      const supplier = Supplier.crear(id, ruc, razonSocial);
      supplier.actualizarInfo('Nueva Razón Social S.A.', 'Pedro', 'Dirección 2', 'pedro@mail.com');

      expect(supplier.razonSocial).toBe('Nueva Razón Social S.A.');
      expect(supplier.contacto).toBe('Pedro');
      expect(supplier.direccion).toBe('Dirección 2');
      expect(supplier.email).toBe('pedro@mail.com');
    });

    it('debe lanzar excepción si se intenta actualizar a razón social vacía', () => {
      const supplier = Supplier.crear(id, ruc, razonSocial);
      expect(() => {
        supplier.actualizarInfo('');
      }).toThrow(RazonSocialVaciaException);
    });
  });

  describe('estados de activación', () => {
    it('debe desactivar y activar el proveedor', () => {
      const supplier = Supplier.crear(id, ruc, razonSocial);
      expect(supplier.activo).toBe(true);

      supplier.desactivar();
      expect(supplier.activo).toBe(false);

      supplier.activar();
      expect(supplier.activo).toBe(true);
    });
  });
});
