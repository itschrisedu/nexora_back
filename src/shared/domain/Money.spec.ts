import { Money } from './Money';

describe('Money Value Object', () => {
  it('debe crearse correctamente con valores positivos', () => {
    const money = Money.create(100.5, 'USD');
    expect(money.amount).toBe(100.5);
    expect(money.currency).toBe('USD');
  });

  it('debe redondear automáticamente a 2 decimales', () => {
    const money = Money.create(10.556);
    expect(money.amount).toBe(10.56);
  });

  it('debe lanzar un error al intentar crear cantidades negativas', () => {
    expect(() => Money.create(-5)).toThrow();
  });

  it('debe permitir sumar cantidades de la misma moneda', () => {
    const m1 = Money.create(10);
    const m2 = Money.create(5.5);
    const result = m1.add(m2);
    expect(result.amount).toBe(15.5);
  });

  it('debe lanzar error al sumar monedas diferentes', () => {
    const m1 = Money.create(10, 'USD');
    const m2 = Money.create(10, 'EUR');
    expect(() => m1.add(m2)).toThrow();
  });

  it('debe permitir restar y dar el saldo correcto', () => {
    const m1 = Money.create(20);
    const m2 = Money.create(7.5);
    const result = m1.subtract(m2);
    expect(result.amount).toBe(12.5);
  });

  it('debe lanzar error si la resta resulta en una cantidad negativa', () => {
    const m1 = Money.create(10);
    const m2 = Money.create(15);
    expect(() => m1.subtract(m2)).toThrow();
  });

  it('debe comparar si una cantidad es mayor que otra', () => {
    const m1 = Money.create(20);
    const m2 = Money.create(10);
    expect(m1.isGreaterThan(m2)).toBe(true);
    expect(m2.isGreaterThan(m1)).toBe(false);
  });
});
