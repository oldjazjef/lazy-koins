import type { BookingKind, IncomeKind } from '../bookings/booking';

/**
 * Country rules behind one interface (F7.7): everything the calculation and the exports need to
 * know about a tax system that is not plain arithmetic — thresholds, which assets are pegged,
 * income categories, labels and form references (F10.3). Only Switzerland exists (`chRules`).
 */

/** Income categories as reported (F7.2) — the booking kinds plus the Earn gap (FACHREGELN). */
export const INCOME_CATEGORIES = [
  'interest',
  'staking',
  'airdrop',
  'launchpool',
  'hardfork',
  'earn_gap',
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const INCOME_CATEGORY_OF: Readonly<Record<IncomeKind, IncomeCategory>> =
  {
    income_interest: 'interest',
    income_staking: 'staking',
    income_airdrop: 'airdrop',
    income_launchpool: 'launchpool',
    income_hardfork: 'hardfork',
  };

/** Kinds reported as one-off events (F7.3) next to the regular figures. */
export const ONE_OFF_KINDS: readonly BookingKind[] = [
  'income_airdrop',
  'income_hardfork',
  'loss',
];

export interface ExportLabels {
  readonly wealthTitle: string;
  readonly incomeTitle: string;
  readonly securitiesList: string;
  readonly noTaxAdvice: string;
  /** Footnote of a position or event without a price in a statement — a fact, no instruction. */
  readonly noPriceNote: string;
  /** Where the two figures go in the tax return, per canton when it differs. */
  readonly formReference: (canton: string) => string;
  readonly categories: Readonly<Record<IncomeCategory, string>>;
}

export interface CountryRules {
  readonly country: string;
  /** Positions with |quantity| below this are dropped (FACHREGELN: 1e-7). Decimal string. */
  readonly dustThreshold: string;
  /** Assets worth exactly 1 USD (FACHREGELN, Kurse). */
  readonly usdPegged: readonly string[];
  /**
   * The currency every amount is valued in (worth 1) — the project's **tax currency** (F4.1a).
   * The country's own rules carry its default (`defaultTaxCurrency`); a project with another
   * currency runs on `withTaxCurrency(rules, currency)`.
   */
  readonly homeCurrency: string;
  /** The tax currency a new project of this country gets (CH → CHF). */
  readonly defaultTaxCurrency: string;
  /** Fiat currencies — never "possible income" and not matched as transfers. */
  readonly fiat: readonly string[];
  /** Assets left out of the Earn-gap method (FACHREGELN: EUR, USDT). */
  readonly earnGapExcluded: readonly string[];
  /** Price lookups may use a price at most this many days away (FACHREGELN: 14). */
  readonly priceToleranceDays: number;
  /** Asset names that read as spam / scam tokens (F6.6), case-insensitive. */
  readonly spamPattern: string;
  /** A withdrawal matches a deposit of at least (1 − tolerance) × its quantity. */
  readonly transferTolerance: string;
  /** … that arrives at most this many hours later (or 1 hour earlier). */
  readonly transferWindowHours: number;
  readonly labels: ExportLabels;
}

export const chRules: CountryRules = {
  country: 'CH',
  dustThreshold: '0.0000001',
  usdPegged: ['USD', 'USDT', 'USDC', 'BUSD', 'FDUSD', 'USDD'],
  homeCurrency: 'CHF',
  defaultTaxCurrency: 'CHF',
  fiat: ['CHF', 'EUR', 'USD', 'GBP'],
  earnGapExcluded: ['EUR', 'USDT'],
  priceToleranceDays: 14,
  spamPattern: 'claim',
  transferTolerance: '0.02',
  transferWindowHours: 7 * 24,
  labels: {
    wealthTitle: 'Steuerwert per 31.12.',
    incomeTitle: 'Ertrag aus beweglichem Vermögen',
    securitiesList: 'Wertschriften- und Guthabenverzeichnis',
    noTaxAdvice:
      'Keine Steuerberatung: Hilfsmittel zur Deklaration, ohne Gewähr. Massgebend sind die Weisungen der Steuerverwaltung.',
    noPriceNote: 'Kein Kurswert verfügbar; nicht im Total enthalten.',
    formReference: (canton) =>
      `Wertschriftenverzeichnis (Kanton ${canton}): Kryptowährungen als Vermögen ohne Verrechnungssteuer; Ertrag als Einkommen aus beweglichem Vermögen.`,
    categories: {
      interest: 'Zinsen / Earn',
      staking: 'Staking',
      airdrop: 'Airdrop',
      launchpool: 'Launchpool',
      hardfork: 'Hardfork',
      earn_gap: 'Earn-Lücke (Differenzmethode)',
    },
  },
};

/** F7.7: the rules of a country, `undefined` when it is not supported. */
export function countryRules(country: string): CountryRules | undefined {
  return country === 'CH' ? chRules : undefined;
}

/**
 * The currencies a project can be valued in (F4.1a): ISO 4217 codes the ECB publishes reference
 * rates for (Frankfurter), so USD → T and EUR → T can be fetched. CHF is the only one with the
 * ESTV Kursliste.
 */
export const TAX_CURRENCIES = [
  'AUD',
  'BGN',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
] as const;
export type TaxCurrency = (typeof TAX_CURRENCIES)[number];

export function isTaxCurrency(value: string): value is TaxCurrency {
  return (TAX_CURRENCIES as readonly string[]).includes(value);
}

/** The tax currency a new project in `country` gets (F4.1a: CH → CHF). */
export function defaultTaxCurrency(country: string): string {
  return countryRules(country)?.defaultTaxCurrency ?? 'CHF';
}

/**
 * The country's rules valued in `currency` (F4.1a): that currency is worth 1 and counts as fiat;
 * everything else (thresholds, pegged assets, labels) stays the country's. The country default
 * returns the rules unchanged, so a CHF project computes exactly as before.
 */
export function withTaxCurrency(
  rules: CountryRules,
  currency: string,
): CountryRules {
  const upper = currency.toUpperCase();
  if (upper === rules.homeCurrency) return rules;
  return {
    ...rules,
    homeCurrency: upper,
    fiat: rules.fiat.includes(upper) ? rules.fiat : [...rules.fiat, upper],
  };
}
