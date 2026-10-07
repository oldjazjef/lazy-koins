import { Pipe, type PipeTransform } from '@angular/core';
import Decimal from 'decimal.js';
import {
  displayFormat,
  groupSeparator,
  type NumberFormat,
} from './locale-format';

/**
 * Number format (F11.2) on the API's decimal **strings** — never through `Number()` (CLAUDE.md,
 * Numbers): `1’234.56` (de-CH) or `1,234.56` (en), negative with a minus, an explicit rounding
 * mode. The format is the active one (`displayFormat()`, a signal) unless given.
 */
const AppDecimal = Decimal.clone({
  precision: 60,
  toExpNeg: -100,
  toExpPos: 100,
});

/** The grouping character of de-CH (as `Intl.NumberFormat('de-CH')` writes it). */
export const GROUP = '’';

function group(fixed: string, format: NumberFormat): string {
  const negative = fixed.startsWith('-');
  const [integer = '', fraction] = (negative ? fixed.slice(1) : fixed).split(
    '.',
  );
  const grouped = integer.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    groupSeparator(format),
  );
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

function parse(value: string | null | undefined): Decimal | undefined {
  if (value === null || value === undefined || value.trim() === '') {
    return undefined;
  }
  try {
    return new AppDecimal(value.trim());
  } catch {
    return undefined;
  }
}

/**
 * An amount with two decimals, commercially rounded: `1’234.56`; `–` for no value. With a
 * currency code (the project's tax currency, F4.1a) it is prefixed: `EUR 1’234.56`. Without one
 * the code belongs in the column header ("Wert EUR").
 */
export function formatChf(
  value: string | null | undefined,
  currency?: string | null,
  format: NumberFormat = displayFormat().numberFormat,
): string {
  const decimal = parse(value);
  if (!decimal) return '–';
  const fixed = decimal.toFixed(2, Decimal.ROUND_HALF_UP);
  const amount = group(fixed === '-0.00' ? '0.00' : fixed, format);
  return currency ? `${currency} ${amount}` : amount;
}

/** `EUR 1’234.56` — an amount in a given currency (F4.1a); `–` for no value. */
export function formatMoney(
  value: string | null | undefined,
  currency: string,
): string {
  return formatChf(value, currency);
}

/** A quantity with its own decimals (at most `maxPlaces`, trailing zeros dropped). */
export function formatQuantity(
  value: string | null | undefined,
  maxPlaces = 10,
  format: NumberFormat = displayFormat().numberFormat,
): string {
  const decimal = parse(value);
  if (!decimal) return '–';
  const places = Math.min(Math.max(decimal.decimalPlaces(), 0), maxPlaces);
  const fixed = new AppDecimal(
    decimal.toFixed(places, Decimal.ROUND_HALF_UP),
  ).toFixed();
  return group(fixed === '-0' ? '0' : fixed, format);
}

/** A plain JS number for display only (file sizes, counts): `1’234.5`. */
export function formatNumber(
  value: number,
  maxPlaces = 1,
  format: NumberFormat = displayFormat().numberFormat,
): string {
  if (!Number.isFinite(value)) return '–';
  return formatQuantity(value.toFixed(maxPlaces), maxPlaces, format);
}

/** Whether a decimal string is negative (for styling), without `Number()`. */
export function isNegative(value: string | null | undefined): boolean {
  return parse(value)?.isNegative() ?? false;
}

/**
 * `{{ amount | lkChf }}` = `1’234.56`; `{{ amount | lkChf: 'EUR' }}` = `EUR 1’234.56`. Impure: it
 * reads the active format (a signal), so a language switch re-renders it at once.
 */
@Pipe({ name: 'lkChf', pure: false })
export class ChfPipe implements PipeTransform {
  transform(
    value: string | null | undefined,
    currency?: string | null,
  ): string {
    return formatChf(value, currency);
  }
}

@Pipe({ name: 'lkQuantity', pure: false })
export class QuantityPipe implements PipeTransform {
  transform(value: string | null | undefined, maxPlaces = 10): string {
    return formatQuantity(value, maxPlaces);
  }
}

/** `{{ size / 1024 | lkNumber }}` — a display number in the active format. */
@Pipe({ name: 'lkNumber', pure: false })
export class NumberPipe implements PipeTransform {
  transform(value: number | null | undefined, maxPlaces = 1): string {
    return value === null || value === undefined
      ? '–'
      : formatNumber(value, maxPlaces);
  }
}
