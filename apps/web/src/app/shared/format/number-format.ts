import { Pipe, type PipeTransform } from '@angular/core';
import Decimal from 'decimal.js';

/**
 * Swiss number format (de-CH, F11.2) on the API's decimal **strings** — never through `Number()`
 * (CLAUDE.md, Numbers): `1’234.56`, negative with a minus, an explicit rounding mode.
 */
const SwissDecimal = Decimal.clone({
  precision: 60,
  toExpNeg: -100,
  toExpPos: 100,
});

/** The grouping character of de-CH (as `Intl.NumberFormat('de-CH')` writes it). */
export const GROUP = '’';

function group(fixed: string): string {
  const negative = fixed.startsWith('-');
  const [integer = '', fraction] = (negative ? fixed.slice(1) : fixed).split(
    '.',
  );
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

function parse(value: string | null | undefined): Decimal | undefined {
  if (value === null || value === undefined || value.trim() === '') {
    return undefined;
  }
  try {
    return new SwissDecimal(value.trim());
  } catch {
    return undefined;
  }
}

/** CHF with two decimals, commercially rounded: `1’234.56`; `–` for no value. */
export function formatChf(value: string | null | undefined): string {
  const decimal = parse(value);
  if (!decimal) return '–';
  const fixed = decimal.toFixed(2, Decimal.ROUND_HALF_UP);
  return group(fixed === '-0.00' ? '0.00' : fixed);
}

/** A quantity with its own decimals (at most `maxPlaces`, trailing zeros dropped). */
export function formatQuantity(
  value: string | null | undefined,
  maxPlaces = 10,
): string {
  const decimal = parse(value);
  if (!decimal) return '–';
  const places = Math.min(Math.max(decimal.decimalPlaces(), 0), maxPlaces);
  const fixed = new SwissDecimal(
    decimal.toFixed(places, Decimal.ROUND_HALF_UP),
  ).toFixed();
  return group(fixed === '-0' ? '0' : fixed);
}

/** Whether a decimal string is negative (for styling), without `Number()`. */
export function isNegative(value: string | null | undefined): boolean {
  return parse(value)?.isNegative() ?? false;
}

@Pipe({ name: 'lkChf' })
export class ChfPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatChf(value);
  }
}

@Pipe({ name: 'lkQuantity' })
export class QuantityPipe implements PipeTransform {
  transform(value: string | null | undefined, maxPlaces = 10): string {
    return formatQuantity(value, maxPlaces);
  }
}
