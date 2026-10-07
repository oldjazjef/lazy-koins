import {
  DEFAULT_TAX_CURRENCY,
  TAX_CURRENCIES,
} from '../../../../core/api/api.types';

/** The usual tax currencies, offered first (F4.1a). */
const COMMON = ['CHF', 'EUR', 'USD', 'GBP'] as const;

export interface TaxCurrencyOptions {
  /** The country default, the project's current one, CHF, EUR, USD, GBP. */
  readonly common: readonly string[];
  /** Every other currency with ECB reference rates, A–Z. */
  readonly others: readonly string[];
}

/** The tax currencies the project forms offer (F4.1a), the country default first. */
export function taxCurrencyOptions(
  country: string,
  current?: string,
): TaxCurrencyOptions {
  const common = [
    ...new Set([
      DEFAULT_TAX_CURRENCY[country] ?? 'CHF',
      ...(current ? [current] : []),
      ...COMMON,
    ]),
  ];
  return {
    common,
    others: TAX_CURRENCIES.filter((code) => !common.includes(code)),
  };
}
