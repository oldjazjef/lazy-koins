import type {
  CountryRules,
  MissingFileHint,
  OpenItem,
} from '@lazykoins/engine';
import type { Locale } from '../../common/i18n/locale';
import type { StoredResult } from '../../calculation/domain/calculation';
import { type DocumentFormat, EXPORT_TEXTS } from './export-texts';

/** Everything a document shows — assembled once, rendered as Excel, HTML/PDF or mail text. */
export interface ExportData {
  readonly projectName: string;
  readonly taxYear: number;
  readonly canton: string;
  /** Name on the statement (settings, else the account's display name). */
  readonly ownerName: string;
  readonly advisorName: string;
  readonly advisorEmail: string;
  /** ISO timestamp of the export (F10.4). */
  readonly createdAt: string;
  readonly calculatedAt: string;
  /** The app that made it, `X.Y.Z+<commit>` (src/app/build-info.ts) — shown under Methodik. */
  readonly appVersion: string;
  /** F11.2: the language of the document (the user's) and its number/date format. */
  readonly locale: Locale;
  readonly format: DocumentFormat;
  /** The country rules with their labels in `locale` (F10.3, `rulesInLanguage`). */
  readonly rules: CountryRules;
  readonly result: StoredResult;
  /**
   * Open items with their tick and note (F8.2). Only the internal report and the Treuhänder
   * mail show them — never a statement for the tax authority.
   */
  readonly items: readonly (OpenItem & {
    readonly done: boolean;
    readonly note: string;
  })[];
  /** F5.8 missing-file hints of the project's files — internal report only. */
  readonly hints: readonly MissingFileHint[];
}

export type ExportVariant = 'einfach' | 'ausfuehrlich' | 'pruefbericht-intern';

/**
 * `Steuern-2025_einfach_2026-01-15.xlsx` — no characters a file system dislikes; the variant in
 * the document's language (`…_simple_…` in English).
 */
export function exportFileName(
  data: Pick<ExportData, 'projectName' | 'createdAt'> &
    Partial<Pick<ExportData, 'locale'>>,
  variant: ExportVariant,
  extension: 'pdf' | 'xlsx',
): string {
  const base =
    data.projectName
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'lazy-koins';
  const name = EXPORT_TEXTS[data.locale ?? 'de-CH'].fileVariants[variant];
  return `${base}_${name}_${data.createdAt.slice(0, 10)}.${extension}`;
}
