import { type Decimal, tryParseDecimal } from '../../money/decimal';

/**
 * How a source writes numbers. Exchanges mostly write `1234.5678`; Excel in de-CH writes
 * `1'234,56`; Revolut writes `CHF 1,234.56`. Normalisation is textual and exact — the digits are
 * never routed through a JS `number`.
 */
export interface NumberFormat {
  /** Decimal separator. */
  readonly decimal: '.' | ',';
  /** Grouping characters to remove (`,` `'` `’` space). */
  readonly thousands: readonly string[];
  /** Remove currency codes/symbols and other letters around the number (`CHF 1.50`, `5 €`). */
  readonly stripText: boolean;
}

export const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  decimal: '.',
  thousands: [],
  stripText: false,
};

/** Text → exact `Decimal`, or `undefined` when it is not a number in this format. */
export function parseNumber(
  text: string,
  format: NumberFormat = DEFAULT_NUMBER_FORMAT,
): Decimal | undefined {
  let value = text.trim();
  if (format.stripText) {
    // Keep digits, signs, separators and an exponent; drop currency codes and symbols.
    // Words of two or more letters (`CHF`, `EUR`, `Fr.`) and currency symbols go; a lone `e`
    // stays, it may be an exponent.
    value = value
      .replace(/[A-Za-z]{2,}\.?/g, '')
      .replace(/[€$£¥₿]/g, '')
      .replace(/\s+/g, '');
  }
  // Accounting negative: (12.50)
  const parenthesised = /^\((.*)\)$/.exec(value);
  if (parenthesised?.[1] !== undefined) value = `-${parenthesised[1]}`;
  for (const separator of format.thousands) {
    value = value.split(separator).join('');
  }
  if (format.decimal === ',') value = value.replace(',', '.');
  value = value.replace(/^([+-])\s+/, '$1');
  return tryParseDecimal(value);
}
