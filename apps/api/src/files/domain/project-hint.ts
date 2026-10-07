import {
  type HintSeverity,
  type MissingFileHint,
  type MissingFileKind,
} from '@lazykoins/engine';
import { isActive, type ProjectFile } from './project-file';

/** A deactivated file of the project (F5.7a) that would cover a hint's platform/account. */
export interface DisabledFileRef {
  readonly id: string;
  readonly name: string;
}

/**
 * F5.8 hints of a project ("Hinweise"): the engine's coverage gaps (`missingFileHints`) plus what
 * the files themselves say — a table without a mapping, a file with row errors. Each has a stable
 * `key`; a dismissal (`done` / `ignored`) is stored per project under it and survives
 * recalculation and new uploads.
 */
export const FILE_HINT_KINDS = ['unrecognisedFile', 'rowErrors'] as const;
export type FileHintKind = (typeof FILE_HINT_KINDS)[number];

/** F7.4: a ticker of the project that several relevant coins carry (market list). */
export const RATE_HINT_KINDS = ['sharedTicker'] as const;
export type RateHintKind = (typeof RATE_HINT_KINDS)[number];

export const PROJECT_HINT_KINDS = [
  'noYearData',
  'startsLate',
  'endsEarly',
  'noYearEndBalance',
  ...FILE_HINT_KINDS,
  ...RATE_HINT_KINDS,
] as const satisfies readonly (MissingFileKind | FileHintKind | RateHintKind)[];
export type ProjectHintKind = MissingFileKind | FileHintKind | RateHintKind;

export const HINT_STATUSES = ['open', 'done', 'ignored'] as const;
export type HintStatus = (typeof HINT_STATUSES)[number];
/** What is stored: `open` is the absence of a row. */
export type StoredHintStatus = Exclude<HintStatus, 'open'>;

export const HINT_NOTE_MAX = 500;

export interface ProjectHint {
  readonly key: string;
  readonly kind: ProjectHintKind;
  readonly severity: HintSeverity;
  /** null for a file that could not be read (no platform known). */
  readonly platform: string | null;
  /** '' when the hint is about the whole platform (or a file). */
  readonly accountId: string;
  readonly accounts: readonly string[];
  readonly date: string | null;
  readonly zeroBalance: boolean;
  /** i18n key with the longer help text. */
  readonly hintKey: string;
  /** File hints: the project file concerned. */
  readonly fileId: string | null;
  readonly fileName: string | null;
  /** rowErrors: how many rows failed; sharedTicker: how many relevant coins carry the ticker. */
  readonly count: number | null;
  /** sharedTicker: the ticker and the coins carrying it ("Name (#rank)", best first). */
  readonly asset?: string | null;
  readonly coins?: readonly string[];
  /**
   * Coverage hints: deactivated files (F5.7a) with records for this platform (and account) —
   * they cover nothing while deactivated, the hint says so. Empty for file hints.
   */
  readonly disabledFiles: readonly DisabledFileRef[];
  readonly status: HintStatus;
  readonly note: string;
}

export interface HintState {
  readonly hintKey: string;
  readonly status: StoredHintStatus;
  readonly note: string;
  readonly updatedAt: string;
}

/**
 * F7.4: a shared ticker as a hint (`sharedTicker:<SYM>`, warning; "ambiguous" as error) — the
 * Kurse tab has the actions ("Coin wählen", "Passt so"); a chosen coin or "Passt so" removes it.
 */
export function sharedTickerHint(shared: {
  readonly symbol: string;
  readonly level: 'ambiguous' | 'warning';
  readonly candidates: readonly { name: string; marketCapRank: number }[];
}): Omit<ProjectHint, 'status' | 'note'> {
  return {
    key: `sharedTicker:${shared.symbol}`,
    kind: 'sharedTicker',
    severity: shared.level === 'ambiguous' ? 'error' : 'warning',
    platform: null,
    accountId: '',
    accounts: [],
    date: null,
    zeroBalance: false,
    hintKey:
      shared.level === 'ambiguous'
        ? 'hints.howTo.sharedTickerAmbiguous'
        : 'hints.howTo.sharedTicker',
    fileId: null,
    fileName: null,
    count: shared.candidates.length,
    asset: shared.symbol,
    coins: shared.candidates.map((c) => `${c.name} (#${c.marketCapRank})`),
    disabledFiles: [],
  };
}

/**
 * The engine's coverage hint in the shape of the hints table. `files`: the project's files — the
 * deactivated ones with records for the hint's platform (and its account, unless the hint is
 * about the whole platform) are named on the hint (F5.7a: "deaktiviert, deckt nichts ab").
 */
export function fromCoverage(
  hint: MissingFileHint,
  files: readonly ProjectFile[] = [],
): Omit<ProjectHint, 'status' | 'note'> {
  const disabledFiles = files
    .filter(
      (file) =>
        !isActive(file) &&
        file.coverage.some(
          (entry) =>
            entry.platform === hint.platform &&
            (hint.accountId === '' ||
              entry.accountId === hint.accountId ||
              // A platform-wide statement (balances only) covers every account.
              (entry.bookings === 0 && entry.holdingDates.length > 0)),
        ),
    )
    .map((file) => ({ id: file.id, name: file.displayName }));
  return {
    disabledFiles,
    key: hint.key,
    kind: hint.kind,
    severity: hint.severity,
    platform: hint.platform,
    accountId: hint.accountId,
    accounts: hint.accounts,
    date: hint.date ?? null,
    zeroBalance: hint.zeroBalance === true,
    hintKey: hint.hintKey,
    fileId: null,
    fileName: null,
    count: null,
  };
}

/**
 * A table without a mapping (its data is not in the calculation) and files with row errors. A
 * deactivated file (F5.7a) has neither — it is ignored on purpose, nothing to remind of.
 */
export function fileHints(
  files: readonly ProjectFile[],
): Omit<ProjectHint, 'status' | 'note'>[] {
  const hints: Omit<ProjectHint, 'status' | 'note'>[] = [];
  for (const file of files) {
    if (!isActive(file)) continue;
    const base = {
      disabledFiles: [],
      platform: file.platform,
      accountId: '',
      accounts: [],
      date: null,
      zeroBalance: false,
      fileId: file.id,
      fileName: file.displayName,
    };
    if (file.status === 'needs_mapping') {
      hints.push({
        ...base,
        key: `unrecognisedFile:${file.id}`,
        kind: 'unrecognisedFile',
        severity: 'error',
        hintKey: 'hints.howTo.unrecognisedFile',
        count: null,
      });
    } else if (
      (file.status === 'standard' || file.status === 'mapped') &&
      file.errorCount > 0
    ) {
      hints.push({
        ...base,
        key: `rowErrors:${file.id}`,
        kind: 'rowErrors',
        severity: 'warning',
        hintKey: 'hints.howTo.rowErrors',
        count: file.errorCount,
      });
    }
  }
  return hints;
}
