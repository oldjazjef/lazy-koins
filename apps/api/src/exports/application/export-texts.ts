import {
  type CountryRules,
  formatChf,
  formatGrouped,
  type MissingFileHint,
  type OpenItem,
  parseDecimal,
  type Position,
  type PositionStatus,
} from '@lazykoins/engine';
import type { Locale } from '../../common/i18n/locale';
import type {
  DateFormat,
  NumberFormat,
} from '../../settings/domain/user-settings';
import { DE_CH_EXPORT_TEXTS } from './texts/export-texts.de-ch';
import { EN_EXPORT_TEXTS } from './texts/export-texts.en';
import type { ExportTexts } from './texts/export-texts.types';

export type { ExportTexts } from './texts/export-texts.types';

/**
 * The server-side message catalogue of the documents (F11.2): one `ExportTexts` per locale.
 * Adding a language = one more file in `texts/` and an entry here (the type makes it complete).
 */
export const EXPORT_TEXTS: Readonly<Record<Locale, ExportTexts>> = {
  'de-CH': DE_CH_EXPORT_TEXTS,
  en: EN_EXPORT_TEXTS,
};

/** How numbers and dates look in a document (F11.2: Zahlen- und Datumsformat). */
export interface DocumentFormat {
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
}

export const SWISS_FORMAT: DocumentFormat = {
  numberFormat: 'de-CH',
  dateFormat: 'dd.MM.yyyy',
};

const GROUP: Readonly<Record<NumberFormat, string>> = {
  'de-CH': '’',
  en: ',',
};

/**
 * Everything a renderer needs in one language and format: the texts plus formatters and the
 * helpers that combine them. Pure — built per document.
 */
export interface ExportKit {
  readonly t: ExportTexts;
  /** An amount with 2 decimals (the currency code is in the header/label); `–` for none. */
  chf(value: string | null): string;
  quantity(value: string): string;
  /** ISO date (or timestamp) → the user's date format. */
  date(iso: string): string;
  statusNote(rules: CountryRules, status: PositionStatus): string | null;
  oneOffLabel(kind: string): string;
  priceSourceText(
    origin: string | null,
    source: string | null,
    date: string | null,
    currency?: string,
  ): string;
  describeItem(item: OpenItem): string;
  describeHint(hint: MissingFileHint): string;
  unpricedPositions(positions: readonly Position[]): string[];
  platformLine(
    positions: readonly Position[],
    mainCount?: number,
  ): { main: string; smallCount: number };
}

/** `2025-12-31` → `31.12.2025` / `2025-12-31` / `31/12/2025` / `12/31/2025`. */
export function formatIsoDate(iso: string, format: DateFormat): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  switch (format) {
    case 'yyyy-MM-dd':
      return `${y}-${m}-${d}`;
    case 'dd/MM/yyyy':
      return `${d}/${m}/${y}`;
    case 'MM/dd/yyyy':
      return `${m}/${d}/${y}`;
    case 'dd.MM.yyyy':
      return `${d}.${m}.${y}`;
  }
}

export function exportKit(
  locale: Locale,
  format: DocumentFormat = SWISS_FORMAT,
): ExportKit {
  const t = EXPORT_TEXTS[locale];
  const group = GROUP[format.numberFormat];
  const quantity = (value: string): string => {
    const decimal = parseDecimal(value);
    const places = Math.min(Math.max(decimal.decimalPlaces(), 0), 10);
    return formatGrouped(decimal, places, 'halfUp', group);
  };
  const date = (iso: string) => formatIsoDate(iso, format.dateFormat);
  return {
    t,
    chf: (value) =>
      value === null ? '–' : formatChf(parseDecimal(value), group),
    quantity,
    date,
    statusNote: (rules, status) => {
      switch (status) {
        case 'missingPrice':
          return `${t.statusLabels.missingPrice}: ${rules.labels.noPriceNote}`;
        case 'spam':
          return `${t.statusLabels.spam}: ${t.statusNoteSpam}`;
        case 'negative':
          return `${t.statusLabels.negative}: ${t.statusNoteNegative}`;
        case 'ok':
          return null;
      }
    },
    oneOffLabel: (kind) =>
      kind === 'loss'
        ? t.oneOff.loss
        : kind === 'income_hardfork'
          ? t.oneOff.hardfork
          : t.oneOff.airdrop,
    priceSourceText: (origin, source, priceDate, currency = 'CHF') => {
      if (!origin) return '–';
      const label = (t.originLabels[origin] ?? origin).replaceAll(
        'CHF',
        currency,
      );
      const extra = [source && source !== 'fixed' ? source : null, priceDate]
        .filter(Boolean)
        .join(' ');
      return extra ? `${label} (${extra})` : label;
    },
    describeItem: (item) =>
      t.openItems[item.reason]({
        where: [item.platform, item.accountId, item.asset]
          .filter(Boolean)
          .join(' / '),
        p: (key) => item.params[key] ?? '',
        date: date(item.date ?? ''),
        asset: item.asset ?? '',
      }),
    describeHint: (hint) =>
      t.hints[hint.kind](
        {
          where: `${hint.platform} / ${hint.accountId || hint.accounts.join(', ')}`,
          date: date(hint.date ?? ''),
        },
        hint.zeroBalance === true,
      ),
    unpricedPositions: (positions) =>
      positions
        .filter((p) => p.status === 'missingPrice')
        .map((p) => `${p.platform} ${p.asset} ${quantity(p.quantity)}`),
    platformLine: (positions, mainCount = 3) => {
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
    },
  };
}

/** The meta line under a title (F10.4): owner, year, canton, created, calculated. */
export function metaLine(
  data: {
    readonly ownerName: string;
    readonly taxYear: number;
    readonly canton: string;
    readonly createdAt: string;
    readonly calculatedAt: string;
  },
  k: ExportKit,
): string {
  return k.t.metaLine({
    owner: data.ownerName,
    taxYear: data.taxYear,
    canton: data.canton,
    created: k.date(data.createdAt),
    calculated: k.date(data.calculatedAt),
  });
}

/** The kit of a document: the user's language and number/date format. */
export function kitOf(data: {
  readonly locale: Locale;
  readonly format: DocumentFormat;
}): ExportKit {
  return exportKit(data.locale, data.format);
}
