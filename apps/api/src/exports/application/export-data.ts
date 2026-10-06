import type { CountryRules, OpenItem } from '@lazykoins/engine';
import type { StoredResult } from '../../calculation/domain/calculation';

/** Everything a statement shows — assembled once, rendered as Excel, HTML/PDF or mail text. */
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
  readonly rules: CountryRules;
  readonly result: StoredResult;
  /** Open items with their tick and note (F8.2). */
  readonly items: readonly (OpenItem & {
    readonly done: boolean;
    readonly note: string;
  })[];
}

/** `Steuern-2025_einfach_2026-01-15.xlsx` — no characters a file system dislikes. */
export function exportFileName(
  data: Pick<ExportData, 'projectName' | 'createdAt'>,
  variant: 'einfach' | 'ausfuehrlich',
  extension: 'pdf' | 'xlsx',
): string {
  const base =
    data.projectName
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'lazy-koins';
  return `${base}_${variant}_${data.createdAt.slice(0, 10)}.${extension}`;
}
