import { ValueObject } from './ValueObject';

interface MoneyProps {
  amount: number;
  currency: string;
}

/**
 * Money — Value Object para cantidades monetarias en NEXORA.
 * No acepta valores negativos. Operaciones inmutables.
 */
export class Money extends ValueObject<MoneyProps> {
  private constructor(props: MoneyProps) {
    super(props);
  }

  static create(amount: number, currency: string = 'USD'): Money {
    if (amount < 0) {
      throw new Error(`Money no puede ser negativo: ${amount}`);
    }
    // Redondear a 2 decimales
    const rounded = Math.round(amount * 100) / 100;
    return new Money({ amount: rounded, currency });
  }

  static zero(currency: string = 'USD'): Money {
    return new Money({ amount: 0, currency });
  }

  get amount(): number {
    return this.props.amount;
  }

  get currency(): string {
    return this.props.currency;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.create(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.amount - other.amount;
    if (result < 0) {
      throw new Error(
        `Operación resultaría en valor negativo: ${this.amount} - ${other.amount}`,
      );
    }
    return Money.create(result, this.currency);
  }

  multiply(factor: number): Money {
    if (factor < 0) {
      throw new Error(`Factor de multiplicación no puede ser negativo: ${factor}`);
    }
    return Money.create(this.amount * factor, this.currency);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount >= other.amount;
  }

  isZero(): boolean {
    return this.amount === 0;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `No se pueden operar monedas diferentes: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  toString(): string {
    return `$${this.amount.toFixed(2)}`;
  }
}
