import { CHECK_KINDS, type Light } from '@lazykoins/engine';
import type { ExportData } from './export-data';
import { kitOf, metaLine } from './export-texts';
import { DE_CH_EXPORT_TEXTS } from './texts/export-texts.de-ch';

/**
 * The internal check report (F10.2a): everything the statements for the tax authority leave out —
 * check lights, open items (with tick and note), positions and events without a price, Earn-gap
 * warnings and missing-file hints. One model, rendered as Excel and as HTML/PDF, in the user's
 * language (F11.2).
 */

/** The German title (the English one is in `ExportTexts.internal.title`). */
export const INTERNAL_TITLE = DE_CH_EXPORT_TEXTS.internal.title;

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
  /** Index of the columns with long text (wide in Excel). */
  readonly wide: readonly number[];
  readonly rows: readonly (readonly ReportCell[])[];
  /** Shown instead of an empty table. */
  readonly empty: string;
}

export interface InternalReport {
  readonly title: string;
  /** The Excel's first sheet. */
  readonly overviewSheet: string;
  readonly meta: string;
  readonly note: string;
  readonly figures: readonly (readonly [string, string])[];
  readonly sections: readonly ReportSection[];
  /** `<html lang>`. */
  readonly lang: string;
}

const c = (text: string, extra: Partial<ReportCell> = {}): ReportCell => ({
  text,
  ...extra,
});

export function internalReport(data: ExportData): InternalReport {
  const k = kitOf(data);
  const { t } = k;
  const r = t.internal;
  const { col } = t;
  const { result } = data;
  const T = data.rules.homeCurrency;
  const open = data.items.filter((item) => !item.done).length;

  const checks: ReportSection = {
    title: r.checks,
    columns: [r.check, r.light, r.points, r.impact(T)],
    numeric: [2, 3],
    wide: [],
    rows: CHECK_KINDS.flatMap((kind) => {
      const check = result.checks.find((x) => x.kind === kind);
      return check
        ? [
            [
              c(t.checkLabels[kind]),
              c(t.lightLabels[check.light], { light: check.light }),
              c(String(check.items)),
              c(k.chf(check.impactChf)),
            ],
          ]
        : [];
    }),
    empty: r.noChecks,
  };

  const items: ReportSection = {
    title: r.openItems,
    columns: [
      col.status,
      r.topic,
      r.description,
      r.estimatedImpact(T),
      r.itemNote,
    ],
    numeric: [3],
    wide: [2],
    rows: [...data.items]
      .sort((a, b) => Number(a.done) - Number(b.done))
      .map((item) => [
        c(item.done ? r.done : r.open),
        c(t.checkLabels[item.check]),
        c(k.describeItem(item)),
        c(k.chf(item.impactChf)),
        c(item.note),
      ]),
    empty: r.noOpenItems,
  };

  const unpriced: ReportSection = {
    title: r.unpriced,
    columns: [
      col.kind,
      col.date,
      col.platform,
      col.account,
      col.asset,
      col.quantity,
      r.hint,
    ],
    numeric: [5],
    wide: [6],
    rows: [
      ...result.positions
        .filter((p) => p.status === 'missingPrice' || p.status === 'negative')
        .map((p) => [
          c(r.positionAtYearEnd),
          c(k.date(`${data.taxYear}-12-31`)),
          c(p.platform),
          c(p.accountId),
          c(p.asset),
          c(k.quantity(p.quantity)),
          c(p.status === 'negative' ? r.negativeBalance : r.noYearEndPrice),
        ]),
      ...result.income
        .filter((l) => l.status === 'missingPrice')
        .map((l) => [
          c(r.incomeKind),
          c(k.date(l.date)),
          c(l.platform),
          c(l.accountId),
          c(l.asset),
          c(k.quantity(l.quantityNet)),
          c(r.noDailyPrice(l.rawType)),
        ]),
      ...result.oneOffEvents
        .filter((ev) => ev.valueChf === null)
        .map((ev) => [
          c(k.oneOffLabel(ev.kind)),
          c(k.date(ev.timestamp)),
          c(ev.platform),
          c(ev.accountId),
          c(ev.asset),
          c(k.quantity(ev.quantity)),
          c(r.priceMissing),
        ]),
    ],
    empty: r.allPriced,
  };

  const gaps: ReportSection = {
    title: r.earnGap,
    columns: [col.platform, col.account, col.asset, col.gap, r.hint],
    numeric: [3],
    wide: [4],
    rows: result.earnGaps
      .filter((gap) => gap.status !== 'income')
      .map((gap) => [
        c(gap.platform),
        c(gap.accountId),
        c(gap.asset),
        c(k.quantity(gap.gapQuantity)),
        c(gap.status === 'negative' ? r.negativeGap : r.noAveragePrice),
      ]),
    empty: r.noGapWarnings,
  };

  const files: ReportSection = {
    title: r.files,
    columns: [r.missingFileHint],
    numeric: [],
    wide: [0],
    rows: data.hints.map((hint) => [c(k.describeHint(hint))]),
    empty: r.noFileHints,
  };

  return {
    title: r.title,
    overviewSheet: r.overviewSheet,
    meta: `${data.projectName} · ${metaLine(data, k)} · lazy-koins ${data.appVersion}`,
    note: r.note,
    figures: [
      [
        `${data.rules.labels.wealthTitle}${data.taxYear}`,
        `${T} ${k.chf(result.totals.wealthChf)}`,
      ],
      [
        `${data.rules.labels.incomeTitle} ${data.taxYear}`,
        `${T} ${k.chf(result.totals.incomeChf)}`,
      ],
      [r.openItems, r.openSummary(open, data.items.length - open)],
    ],
    sections: [checks, items, unpriced, gaps, files],
    lang: t.htmlLang,
  };
}
