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

export interface TemplateSheet {
  readonly name: string;
  readonly columns: readonly StandardColumn[];
  readonly examples: readonly (readonly string[])[];
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

/** The CSV template for one record type: header + example rows. */
export function standardTemplateCsv(type: 'bookings' | 'holdings'): string {
  const sheet = TEMPLATE_SHEETS[type];
  return toCsv([
    columnNames(type === 'bookings' ? BOOKING_COLUMNS : HOLDING_COLUMNS),
    ...sheet.examples,
  ]);
}
