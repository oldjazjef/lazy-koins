import { CHECK_KINDS, type Light } from '@lazykoins/engine';
import type { ExportData } from './export-data';
import {
  CHECK_LABELS,
  chf,
  describeHint,
  describeItem,
  LIGHT_LABELS,
  oneOffLabel,
  quantity,
  swissDate,
} from './export-texts';

/**
 * The internal check report (F10.2a): everything the statements for the tax authority leave out —
 * check lights, open items (with tick and note), positions and events without a price, Earn-gap
 * warnings and missing-file hints. One model, rendered as Excel and as HTML/PDF.
 */

export const INTERNAL_TITLE =
  'Interner Prüfbericht – nicht für die Steuerbehörde';

export interface ReportCell {
  readonly text: string;
  /** A traffic light (only in the checks section). */
  readonly light?: Light;
}

export interface ReportSection {
  /** Also the Excel sheet name (≤ 31 characters, no `[]:*?/\`). */
  readonly title: string;
  readonly columns: readonly string[];
  /** Index of the columns holding figures (right-aligned). */
  readonly numeric: readonly number[];
  readonly rows: readonly (readonly ReportCell[])[];
  /** Shown instead of an empty table. */
  readonly empty: string;
}

export interface InternalReport {
  readonly title: string;
  readonly meta: string;
  readonly note: string;
  readonly figures: readonly (readonly [string, string])[];
  readonly sections: readonly ReportSection[];
}

const t = (text: string, extra: Partial<ReportCell> = {}): ReportCell => ({
  text,
  ...extra,
});

export function internalReport(data: ExportData): InternalReport {
  const { result } = data;
  const T = data.rules.homeCurrency;
  const open = data.items.filter((item) => !item.done).length;

  const checks: ReportSection = {
    title: 'Prüfungen',
    columns: ['Prüfung', 'Ampel', 'Punkte', `Auswirkung ${T}`],
    numeric: [2, 3],
    rows: CHECK_KINDS.flatMap((kind) => {
      const check = result.checks.find((c) => c.kind === kind);
      return check
        ? [
            [
              t(CHECK_LABELS[kind]),
              t(LIGHT_LABELS[check.light], { light: check.light }),
              t(String(check.items)),
              t(chf(check.impactChf)),
            ],
          ]
        : [];
    }),
    empty: 'Keine Prüfungen berechnet.',
  };

  const items: ReportSection = {
    title: 'Offene Punkte',
    columns: [
      'Status',
      'Thema',
      'Beschreibung',
      `Geschätzte Auswirkung ${T}`,
      'Notiz',
    ],
    numeric: [3],
    rows: [...data.items]
      .sort((a, b) => Number(a.done) - Number(b.done))
      .map((item) => [
        t(item.done ? 'erledigt' : 'offen'),
        t(CHECK_LABELS[item.check]),
        t(describeItem(item)),
        t(chf(item.impactChf)),
        t(item.note),
      ]),
    empty: 'Keine offenen Punkte.',
  };

  const unpriced: ReportSection = {
    title: 'Ohne Kurs',
    columns: [
      'Art',
      'Datum',
      'Plattform',
      'Konto',
      'Asset',
      'Menge',
      'Hinweis',
    ],
    numeric: [5],
    rows: [
      ...result.positions
        .filter((p) => p.status === 'missingPrice' || p.status === 'negative')
        .map((p) => [
          t('Position 31.12.'),
          t(`31.12.${data.taxYear}`),
          t(p.platform),
          t(p.accountId),
          t(p.asset),
          t(quantity(p.quantity)),
          t(
            p.status === 'negative'
              ? 'negativer Saldo – Buchungen fehlen?'
              : 'kein Kurs per 31.12. – ESTV-Kurs nachtragen',
          ),
        ]),
      ...result.income
        .filter((l) => l.status === 'missingPrice')
        .map((l) => [
          t('Ertrag'),
          t(swissDate(l.date)),
          t(l.platform),
          t(l.accountId),
          t(l.asset),
          t(quantity(l.quantityNet)),
          t(`kein Tageskurs (${l.rawType}) – Kurs nachtragen`),
        ]),
      ...result.oneOffEvents
        .filter((ev) => ev.valueChf === null)
        .map((ev) => [
          t(oneOffLabel(ev.kind)),
          t(swissDate(ev.timestamp)),
          t(ev.platform),
          t(ev.accountId),
          t(ev.asset),
          t(quantity(ev.quantity)),
          t('Kurs fehlt – ESTV-Kurs nachtragen'),
        ]),
    ],
    empty: 'Alle Positionen und Erträge haben einen Kurs.',
  };

  const gaps: ReportSection = {
    title: 'Earn-Lücke',
    columns: ['Plattform', 'Konto', 'Asset', 'Lücke', 'Hinweis'],
    numeric: [3],
    rows: result.earnGaps
      .filter((gap) => gap.status !== 'income')
      .map((gap) => [
        t(gap.platform),
        t(gap.accountId),
        t(gap.asset),
        t(quantity(gap.gapQuantity)),
        t(
          gap.status === 'negative'
            ? 'negative Lücke – Bestand oder Historie prüfen'
            : 'kein Jahresmittelkurs – Kurs nachtragen',
        ),
      ]),
    empty: 'Keine Warnungen zur Earn-Lücke.',
  };

  const files: ReportSection = {
    title: 'Dateien',
    columns: ['Hinweis zu fehlenden Dateien'],
    numeric: [],
    rows: data.hints.map((hint) => [t(describeHint(hint))]),
    empty: 'Keine Hinweise zu fehlenden Dateien.',
  };

  return {
    title: INTERNAL_TITLE,
    meta: `${data.projectName} · ${data.ownerName} · Steuerjahr ${data.taxYear} · Kanton ${data.canton} · erstellt am ${swissDate(data.createdAt)} · berechnet am ${swissDate(data.calculatedAt)} · lazy-koins ${data.appVersion}`,
    note: 'Arbeitsunterlage für dich und deinen Treuhänder – nicht der Steuererklärung beilegen. Die Auszüge für die Steuerbehörde enthalten diese Punkte nicht.',
    figures: [
      [
        `${data.rules.labels.wealthTitle}${data.taxYear}`,
        `${T} ${chf(result.totals.wealthChf)}`,
      ],
      [
        `${data.rules.labels.incomeTitle} ${data.taxYear}`,
        `${T} ${chf(result.totals.incomeChf)}`,
      ],
      ['Offene Punkte', `${open} offen, ${data.items.length - open} erledigt`],
    ],
    sections: [checks, items, unpriced, gaps, files],
  };
}
