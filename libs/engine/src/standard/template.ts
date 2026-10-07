import { BOOKING_KINDS } from '../bookings/booking';
import {
  BOOKING_COLUMNS,
  BOOKINGS_SHEET,
  columnNames,
  EXPLANATION_SHEET,
  HOLDING_COLUMNS,
  HOLDINGS_SHEET,
  STANDARD_FORMAT_NAME,
  type StandardColumn,
} from './standard-format';
import type { StandardExportLanguage } from './standard-export';

/**
 * The downloadable template of the standard format. The engine owns the content (columns,
 * explanations, example rows); the API renders it — CSV here, XLSX with exceljs (explanation
 * sheet, example rows, a validation list for `Art`).
 */

/** Synthetic example rows: a trade with fee, a deposit, staking income, a transfer. */
export const BOOKING_EXAMPLES: readonly (readonly string[])[] = [
  [
    '2025-03-01T14:30:00+01:00',
    'kraken',
    'spot',
    'trade',
    'BTC',
    '0.01000000',
    '',
    '',
    '',
    '',
    'T-0001',
    'Kauf BTC',
  ],
  [
    '2025-03-01T14:30:00+01:00',
    'kraken',
    'spot',
    'trade',
    'CHF',
    '-850.00',
    '1.36',
    'CHF',
    '',
    '',
    'T-0001',
    'Kauf BTC',
  ],
  [
    '2025-04-10T09:00:00Z',
    'kraken',
    'spot',
    'deposit',
    'ETH',
    '1.5',
    '',
    '',
    '',
    '',
    '',
    'von Ledger',
  ],
  [
    '2025-05-02T00:00:00Z',
    'kraken',
    'earn',
    'income_staking',
    'DOT',
    '0.123456789012345678',
    '',
    '',
    '4.20',
    '',
    '',
    '',
  ],
  [
    '2025-06-15T08:00:00Z',
    'kraken',
    'spot',
    'transfer',
    'DOT',
    '-10',
    '',
    '',
    '',
    '',
    'X-7',
    'nach earn',
  ],
];

export const HOLDING_EXAMPLES: readonly (readonly string[])[] = [
  [
    'kraken',
    'spot',
    'BTC',
    '0.01',
    '2025-12-31',
    '',
    '',
    'Kontoauszug Kraken 31.12.2025',
  ],
  [
    'ledger-nano',
    'main',
    'ETH',
    '1.5',
    '2025-12-31',
    '',
    '',
    'Screenshot Ledger Live',
  ],
];

export const TEMPLATE_EXPLANATION: readonly string[] = [
  `Vorlage ${STANDARD_FORMAT_NAME}`,
  `Blatt "${BOOKINGS_SHEET}": eine Zeile pro Bewegung eines Assets auf einem Konto.`,
  `Blatt "${HOLDINGS_SHEET}": Bestände an einem Stichtag (z. B. laut Kontoauszug oder für eine Wallet ohne Export).`,
  'Spalten mit * sind Pflicht. Zahlen mit Punkt als Dezimaltrennzeichen, ohne Tausendertrennzeichen.',
  'Ein Handel besteht aus zwei Zeilen (Abgang und Zugang) mit derselben Referenz.',
  `Erlaubte Werte für "Art": ${BOOKING_KINDS.join(', ')}.`,
  'Die Beispielzeilen sind erfunden — vor dem Hochladen löschen.',
];

/**
 * F11.2: the template in English. The format is defined by its German column headers and sheet
 * names (`Buchungen`, `Bestände`) — they stay German so the file can be uploaded again, exactly as
 * in the data export (F10.7); only the explanations, the example notes and the labels follow the
 * language.
 */
const TEMPLATE_EXPLANATION_EN: readonly string[] = [
  `Template ${STANDARD_FORMAT_NAME}`,
  `The column headers and the sheet names ("${BOOKINGS_SHEET}", "${HOLDINGS_SHEET}") stay German: they define the format, so the file can be uploaded again. Do not rename them.`,
  `Sheet "${BOOKINGS_SHEET}" (bookings): one row per movement of an asset on an account.`,
  `Sheet "${HOLDINGS_SHEET}" (holdings): balances at a reference date (e.g. from an account statement, or for a wallet without an export).`,
  'Columns marked * are required. Numbers with a dot as the decimal separator, without thousands separators.',
  'A trade consists of two rows (outflow and inflow) with the same reference ("Referenz").',
  `Allowed values for "Art" (type): ${BOOKING_KINDS.join(', ')}.`,
  'The example rows are made up — delete them before uploading.',
];

const BOOKING_DESCRIPTIONS_EN: Readonly<
  Record<keyof typeof BOOKING_COLUMNS, string>
> = {
  timestamp:
    'Date and time (Zeitpunkt) WITH time zone in ISO 8601, e.g. 2025-03-01T14:30:00+01:00 or 2025-03-01T13:30:00Z.',
  platform:
    'Exchange or wallet (Plattform), e.g. kraken, binance, ledger-nano.',
  account: 'Account on the platform (Konto), e.g. spot, earn. Empty = main.',
  kind: `Type of booking (Art), one of: ${BOOKING_KINDS.join(', ')}.`,
  asset: 'Symbol of the asset, e.g. BTC, ETH, CHF.',
  quantity:
    'Quantity (Menge) with sign: positive = inflow, negative = outflow. Dot as the decimal separator, up to 18 decimals.',
  fee: 'Fee (Gebühr) of this booking as a positive number (deducted in addition).',
  feeAsset:
    'Asset of the fee (Gebühr-Asset). Empty = the same asset as the booking.',
  priceChf: 'Price per unit in CHF (Preis CHF) at that time, if known.',
  priceUsd: 'Price per unit in USD (Preis USD) at that time, if known.',
  group:
    'Reference (Referenz): the same reference links the parts of a trade (buy leg, sell leg, fee).',
  note: 'Note (Notiz): free text, e.g. origin or explanation.',
};

const HOLDING_DESCRIPTIONS_EN: Readonly<
  Record<keyof typeof HOLDING_COLUMNS, string>
> = {
  platform: 'Exchange or wallet (Plattform), e.g. kraken.',
  account: 'Account on the platform (Konto). Empty = main.',
  asset: 'Symbol of the asset.',
  quantity:
    'Balance (Menge) at the reference date (dot as the decimal separator).',
  asOf: 'Reference date (Stichtag) as YYYY-MM-DD, e.g. 2025-12-31 (end of day).',
  priceChf: 'Rate per unit in CHF (Preis CHF) at the reference date, if known.',
  priceUsd: 'Rate per unit in USD (Preis USD) at the reference date, if known.',
  evidence:
    'Evidence (Beleg): where the value comes from, e.g. "Kraken account statement 31.12.2025, p. 2".',
};

/** The free-text cells (Notiz, Beleg) of the example rows in English; the data stays the same. */
const EXAMPLE_NOTES_EN: Readonly<Record<string, string>> = {
  'Kauf BTC': 'Buy BTC',
  'von Ledger': 'from Ledger',
  'nach earn': 'to earn',
  'Kontoauszug Kraken 31.12.2025': 'Kraken account statement 31.12.2025',
  'Screenshot Ledger Live': 'Screenshot Ledger Live',
};

/** Languages of the template (F11.2) — the same as the data export's information columns. */
export type TemplateLanguage = StandardExportLanguage;

/** The labels of the XLSX explanation sheet and the `Art` drop-down. */
export interface TemplateLabels {
  readonly sheet: (name: string) => string;
  readonly column: string;
  readonly required: string;
  readonly description: string;
  /** The drop-down's error when a value is not in the list. */
  readonly kindListError: string;
}

const TEMPLATE_LABELS: Readonly<Record<TemplateLanguage, TemplateLabels>> = {
  'de-CH': {
    sheet: (name) => `Blatt "${name}"`,
    column: 'Spalte',
    required: 'Pflicht',
    description: 'Beschreibung',
    kindListError: 'Bitte einen Wert aus der Liste wählen.',
  },
  en: {
    sheet: (name) => `Sheet "${name}"`,
    column: 'Column',
    required: 'Required',
    description: 'Description',
    kindListError: 'Please choose a value from the list.',
  },
};

export interface TemplateSheet {
  readonly name: string;
  readonly columns: readonly StandardColumn[];
  readonly examples: readonly (readonly string[])[];
}

export interface TemplateContent {
  readonly bookings: TemplateSheet;
  readonly holdings: TemplateSheet;
  readonly explanationSheet: string;
  readonly explanation: readonly string[];
  readonly labels: TemplateLabels;
}

export const TEMPLATE_SHEETS: {
  readonly bookings: TemplateSheet;
  readonly holdings: TemplateSheet;
  readonly explanationSheet: string;
} = {
  bookings: {
    name: BOOKINGS_SHEET,
    columns: Object.values(BOOKING_COLUMNS),
    examples: BOOKING_EXAMPLES,
  },
  holdings: {
    name: HOLDINGS_SHEET,
    columns: Object.values(HOLDING_COLUMNS),
    examples: HOLDING_EXAMPLES,
  },
  explanationSheet: EXPLANATION_SHEET,
};

function described<K extends string>(
  columns: Readonly<Record<K, StandardColumn>>,
  descriptions: Readonly<Record<K, string>>,
): StandardColumn[] {
  return (Object.keys(columns) as K[]).map((key) => ({
    ...columns[key],
    description: descriptions[key],
  }));
}

function translatedExamples(
  rows: readonly (readonly string[])[],
): (readonly string[])[] {
  return rows.map((row) => row.map((cell) => EXAMPLE_NOTES_EN[cell] ?? cell));
}

/**
 * The template's content in a language (F11.2): explanations, example notes and labels follow
 * it; the column names, sheet names and every value the importer reads stay as they are.
 */
export function templateContent(
  language: TemplateLanguage = 'de-CH',
): TemplateContent {
  if (language !== 'en') {
    return {
      ...TEMPLATE_SHEETS,
      explanation: TEMPLATE_EXPLANATION,
      labels: TEMPLATE_LABELS['de-CH'],
    };
  }
  return {
    bookings: {
      name: BOOKINGS_SHEET,
      columns: described(BOOKING_COLUMNS, BOOKING_DESCRIPTIONS_EN),
      examples: translatedExamples(BOOKING_EXAMPLES),
    },
    holdings: {
      name: HOLDINGS_SHEET,
      columns: described(HOLDING_COLUMNS, HOLDING_DESCRIPTIONS_EN),
      examples: translatedExamples(HOLDING_EXAMPLES),
    },
    explanationSheet: 'Explanation',
    explanation: TEMPLATE_EXPLANATION_EN,
    labels: TEMPLATE_LABELS.en,
  };
}

/** RFC 4180: quote a cell when it holds a comma, quote or line break. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join(','),
    )
    .join('\r\n')
    .concat('\r\n');
}

/** The CSV template for one record type: header (always German) + example rows. */
export function standardTemplateCsv(
  type: 'bookings' | 'holdings',
  language: TemplateLanguage = 'de-CH',
): string {
  const sheet = templateContent(language)[type];
  return toCsv([
    columnNames(type === 'bookings' ? BOOKING_COLUMNS : HOLDING_COLUMNS),
    ...sheet.examples,
  ]);
}
