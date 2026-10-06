import { BOOKING_KINDS } from '../bookings/booking';

/**
 * The standard format **"lazy-koins Buchungen v1"** — the single input model. Every file becomes
 * these two record types, either because it is written in this format (template download, F5.1)
 * or through a mapping spec (`mapping/`). Column names are German, as the user sees them.
 *
 * - **Buchungen**: one movement of one asset on one account.
 * - **Bestände**: a balance at a date (statement balance, manual position with evidence).
 *
 * In an XLSX both live in their own sheet (`Buchungen`, `Bestände`); a CSV holds one of them,
 * recognised by its header row.
 */
export const STANDARD_FORMAT_NAME = 'lazy-koins Buchungen v1';
export const STANDARD_FORMAT_VERSION = 1;

export interface StandardColumn {
  /** The column header, exactly as in the template. */
  readonly name: string;
  readonly required: boolean;
  /** German explanation for the template's explanation sheet. */
  readonly description: string;
}

export const BOOKING_COLUMNS = {
  timestamp: {
    name: 'Zeitpunkt',
    required: true,
    description:
      'Datum und Uhrzeit MIT Zeitzone im Format ISO 8601, z. B. 2025-03-01T14:30:00+01:00 oder 2025-03-01T13:30:00Z.',
  },
  platform: {
    name: 'Plattform',
    required: true,
    description: 'Börse oder Wallet, z. B. kraken, binance, ledger-nano.',
  },
  account: {
    name: 'Konto',
    required: false,
    description: 'Konto auf der Plattform (z. B. spot, earn). Leer = main.',
  },
  kind: {
    name: 'Art',
    required: true,
    description: `Art der Buchung, einer dieser Werte: ${BOOKING_KINDS.join(', ')}.`,
  },
  asset: {
    name: 'Asset',
    required: true,
    description: 'Kürzel des Assets, z. B. BTC, ETH, CHF.',
  },
  quantity: {
    name: 'Menge',
    required: true,
    description:
      'Menge mit Vorzeichen: positiv = Zugang, negativ = Abgang. Punkt als Dezimaltrennzeichen, bis 18 Nachkommastellen.',
  },
  fee: {
    name: 'Gebühr',
    required: false,
    description:
      'Gebühr zu dieser Buchung als positive Zahl (wird zusätzlich abgezogen).',
  },
  feeAsset: {
    name: 'Gebühr-Asset',
    required: false,
    description: 'Asset der Gebühr. Leer = gleiches Asset wie die Buchung.',
  },
  priceChf: {
    name: 'Preis CHF',
    required: false,
    description: 'Preis pro Einheit in CHF zum Zeitpunkt, falls bekannt.',
  },
  priceUsd: {
    name: 'Preis USD',
    required: false,
    description: 'Preis pro Einheit in USD zum Zeitpunkt, falls bekannt.',
  },
  group: {
    name: 'Referenz',
    required: false,
    description:
      'Gleiche Referenz verbindet die Teile eines Handels (Kauf-Bein, Verkauf-Bein, Gebühr).',
  },
  note: {
    name: 'Notiz',
    required: false,
    description: 'Freitext, z. B. Herkunft oder Erklärung.',
  },
} as const satisfies Record<string, StandardColumn>;

export const HOLDING_COLUMNS = {
  platform: {
    name: 'Plattform',
    required: true,
    description: 'Börse oder Wallet, z. B. kraken.',
  },
  account: {
    name: 'Konto',
    required: false,
    description: 'Konto auf der Plattform. Leer = main.',
  },
  asset: { name: 'Asset', required: true, description: 'Kürzel des Assets.' },
  quantity: {
    name: 'Menge',
    required: true,
    description: 'Bestand am Stichtag (Punkt als Dezimaltrennzeichen).',
  },
  asOf: {
    name: 'Stichtag',
    required: true,
    description:
      'Datum des Bestands im Format JJJJ-MM-TT, z. B. 2025-12-31 (Tagesende).',
  },
  priceChf: {
    name: 'Preis CHF',
    required: false,
    description: 'Kurs pro Einheit in CHF am Stichtag, falls bekannt.',
  },
  priceUsd: {
    name: 'Preis USD',
    required: false,
    description: 'Kurs pro Einheit in USD am Stichtag, falls bekannt.',
  },
  evidence: {
    name: 'Beleg',
    required: false,
    description:
      'Woher der Wert stammt, z. B. "Kontoauszug Kraken 31.12.2025, S. 2".',
  },
} as const satisfies Record<string, StandardColumn>;

export type BookingColumnKey = keyof typeof BOOKING_COLUMNS;
export type HoldingColumnKey = keyof typeof HOLDING_COLUMNS;

export const BOOKINGS_SHEET = 'Buchungen';
export const HOLDINGS_SHEET = 'Bestände';
export const EXPLANATION_SHEET = 'Erklärung';

export const DEFAULT_ACCOUNT = 'main';

export function columnNames(columns: Record<string, StandardColumn>): string[] {
  return Object.values(columns).map((column) => column.name);
}

export function requiredColumnNames(
  columns: Record<string, StandardColumn>,
): string[] {
  return Object.values(columns)
    .filter((column) => column.required)
    .map((column) => column.name);
}
