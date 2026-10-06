import {
  type CheckKind,
  type CountryRules,
  formatChf,
  formatGrouped,
  type IncomeCategory,
  type Light,
  type MissingFileHint,
  type OpenItem,
  parseDecimal,
  type Position,
  type PositionStatus,
  type QuantitySource,
} from '@lazykoins/engine';

/**
 * German texts of the statements (the exports have one language, like the app). Country-specific
 * wording comes from the country rules (F10.3); this file holds the rest.
 */

export const CHECK_LABELS: Readonly<Record<CheckKind, string>> = {
  ledgerVsStatement: 'Saldo laut Ledger = Saldo laut Kontoauszug',
  earnGap: 'Fehlende Earn-Erträge (Differenzmethode)',
  unmatchedWithdrawals: 'Auszahlungen ohne Gegenbuchung',
  unmatchedDeposits: 'Zuflüsse ohne Gegenbuchung (möglicher Ertrag)',
  openingBalance: 'Anfangsbestand = Endbestand des Vorjahres',
  missingPrices: 'Positionen ohne Kurs',
  unclassified: 'Nicht zugeordnete Buchungen',
  walletNetworks: 'Wallets auf allen Netzwerken geprüft',
};

export const LIGHT_LABELS: Readonly<Record<Light, string>> = {
  green: 'grün',
  yellow: 'gelb',
  red: 'rot',
  grey: 'nicht anwendbar',
};

/**
 * Status of a position in a statement: neutral facts for the tax authority (the Excel's SUMIFS
 * and COUNTIFS match these texts).
 */
export const STATUS_LABELS: Readonly<Record<PositionStatus, string>> = {
  ok: 'ok',
  missingPrice: 'ohne Kurswert',
  spam: 'Spam',
  negative: 'Negativ',
};

/** Footnotes under the holdings of a statement, per status that is not in the total. */
export function statusNote(
  rules: CountryRules,
  status: PositionStatus,
): string | null {
  switch (status) {
    case 'missingPrice':
      return `${STATUS_LABELS.missingPrice}: ${rules.labels.noPriceNote}`;
    case 'spam':
      return `${STATUS_LABELS.spam}: Spam-/Scam-Token ohne Marktwert; nicht im Total enthalten.`;
    case 'negative':
      return `${STATUS_LABELS.negative}: negativer Saldo; nicht im Total enthalten.`;
    case 'ok':
      return null;
  }
}

export function oneOffLabel(kind: string): string {
  return kind === 'loss'
    ? 'Verlust'
    : kind === 'income_hardfork'
      ? 'Hardfork'
      : 'Airdrop';
}

export const QUANTITY_SOURCE_LABELS: Readonly<Record<QuantitySource, string>> =
  {
    statement: 'Kontoauszug',
    ledger: 'Ledger (Σ Menge − Σ Gebühr)',
    manual: 'Manuell (Korrektur)',
  };

const ORIGIN_LABELS: Readonly<Record<string, string>> = {
  home: 'CHF',
  override: 'Überschrieben',
  estv: 'ESTV-Kursliste',
  recordChf: 'Kurs CHF laut Beleg',
  recordUsd: 'Kurs USD laut Beleg × USD/CHF',
  recordValueUsd: 'USD-Wert laut Plattform × USD/CHF',
  pegged: 'Stablecoin = 1 USD × USD/CHF',
  fx: 'Devisenkurs (EZB)',
  tableChf: 'Tageskurs CHF',
  tableUsd: 'Tagesschluss USD × USD/CHF',
};

export function priceSourceText(
  origin: string | null,
  source: string | null,
  date: string | null,
): string {
  if (!origin) return '–';
  const label = ORIGIN_LABELS[origin] ?? origin;
  const extra = [source && source !== 'fixed' ? source : null, date]
    .filter(Boolean)
    .join(' ');
  return extra ? `${label} (${extra})` : label;
}

export function categoryLabel(
  rules: CountryRules,
  category: IncomeCategory,
): string {
  return rules.labels.categories[category];
}

export function chf(value: string | null): string {
  return value === null ? '–' : formatChf(parseDecimal(value));
}

export function quantity(value: string): string {
  const decimal = parseDecimal(value);
  const places = Math.min(Math.max(decimal.decimalPlaces(), 0), 10);
  return formatGrouped(decimal, places, 'halfUp');
}

/** ISO date → `31.12.2025`. */
export function swissDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

const p = (item: OpenItem, key: string) => item.params[key] ?? '';

/**
 * One line describing an open item — for the internal report and the Treuhänder mail only, never
 * for a statement (it may tell someone what to do).
 */
export function describeItem(item: OpenItem): string {
  const where = [item.platform, item.accountId, item.asset]
    .filter(Boolean)
    .join(' / ');
  switch (item.reason) {
    case 'balanceDiffers':
      return `${where}: Ledger ${p(item, 'actual')} ≠ Kontoauszug ${p(item, 'expected')} (Differenz ${p(item, 'difference')})`;
    case 'ledgerBalanceDiffers':
      return `${where}: Σ Buchungen ${p(item, 'actual')} ≠ Saldo-Spalte ${p(item, 'expected')}`;
    case 'negativeBalance':
      return `${where}: negativer Bestand ${p(item, 'quantity')} – Buchungen fehlen`;
    case 'negativeEarnGap':
      return `${where}: negative Earn-Lücke ${p(item, 'gap')} – Bestand oder Historie prüfen`;
    case 'earnGapWithoutPrice':
      return `${where}: Earn-Lücke ${p(item, 'gap')} ohne Jahresmittelkurs`;
    case 'withdrawalWithoutDeposit':
      return `${where}: Auszahlung ${p(item, 'quantity')} am ${swissDate(item.date ?? '')} ohne Eingang auf einem eigenen Konto`;
    case 'depositWithoutWithdrawal':
      return `${where}: Zufluss ${p(item, 'quantity')} am ${swissDate(item.date ?? '')} ohne Herkunft – möglicher Ertrag`;
    case 'openingDiffers':
      return `${where}: Anfangsbestand ${p(item, 'actual')} ≠ Endbestand Vorjahr ${p(item, 'expected')}`;
    case 'positionWithoutPrice':
      return `${where}: kein Kurs per 31.12. – ESTV-Kurs nachtragen`;
    case 'incomeWithoutPrice':
      return `${item.asset ?? ''}: ${p(item, 'count')} Ertragsbuchungen ohne Kurs`;
    case 'oneOffWithoutPrice':
      return `${where}: Einmalereignis ohne Kurs – ESTV-Kurs nachtragen`;
    case 'unclassifiedBookings':
      return `${where}: ${p(item, 'count')} Buchungen „${p(item, 'rawType')}“ nicht zugeordnet`;
    case 'walletNetworksNotAvailable':
      return 'Wallet-Abfrage auf allen Netzwerken ist noch nicht verfügbar – manuell prüfen';
  }
}

/** One line of an F5.8 missing-file hint (internal report). */
export function describeHint(hint: MissingFileHint): string {
  const where = `${hint.platform} / ${hint.accountId || hint.accounts.join(', ')}`;
  switch (hint.kind) {
    case 'noYearData':
      return hint.zeroBalance
        ? `${where}: Buchungen enden am ${swissDate(hint.date ?? '')}, danach Saldo 0 – nichts fehlt`
        : `${where}: keine Buchungen im Steuerjahr – Historie endet am ${swissDate(hint.date ?? '')}`;
    case 'startsLate':
      return `${where}: Buchungen erst ab ${swissDate(hint.date ?? '')} – Export ab 01.01. fehlt`;
    case 'endsEarly':
      return hint.zeroBalance
        ? `${where}: Buchungen nur bis ${swissDate(hint.date ?? '')}, danach Saldo 0 – nichts fehlt`
        : `${where}: Buchungen nur bis ${swissDate(hint.date ?? '')} – Export bis 31.12. fehlt`;
    case 'noYearEndBalance':
      return `${where}: kein Saldo/Kontoauszug per 31.12.`;
  }
}

/** Positions without a value, as `platform asset quantity` (the footnote of the simple statement). */
export function unpricedPositions(positions: readonly Position[]): string[] {
  return positions
    .filter((p) => p.status === 'missingPrice')
    .map((p) => `${p.platform} ${p.asset} ${quantity(p.quantity)}`);
}

/** Positions of a platform for the securities list: main positions, small ones counted (F10.1). */
export function platformLine(
  positions: readonly Position[],
  mainCount = 3,
): { main: string; smallCount: number } {
  const valued = positions
    .filter((p) => p.status !== 'spam')
    .sort((a, b) =>
      parseDecimal(b.valueChf ?? '0').cmp(parseDecimal(a.valueChf ?? '0')),
    );
  return {
    main: valued
      .slice(0, mainCount)
      .map((p) => `${p.asset} ${quantity(p.quantity)}`)
      .join(', '),
    smallCount: Math.max(valued.length - mainCount, 0),
  };
}
