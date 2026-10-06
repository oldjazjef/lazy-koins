import {
  type HintSeverity,
  type MissingFileHint,
  type MissingFileKind,
} from '@lazykoins/engine';
import type { ProjectFile } from './project-file';

/**
 * F5.8 hints of a project ("Hinweise"): the engine's coverage gaps (`missingFileHints`) plus what
 * the files themselves say — a table without a mapping, a file with row errors. Each has a stable
 * `key`; a dismissal (`done` / `ignored`) is stored per project under it and survives
 * recalculation and new uploads.
 */
export const FILE_HINT_KINDS = ['unrecognisedFile', 'rowErrors'] as const;
export type FileHintKind = (typeof FILE_HINT_KINDS)[number];

export const PROJECT_HINT_KINDS = [
  'noYearData',
  'startsLate',
  'endsEarly',
  'noYearEndBalance',
  ...FILE_HINT_KINDS,
] as const satisfies readonly (MissingFileKind | FileHintKind)[];
export type ProjectHintKind = MissingFileKind | FileHintKind;

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
  /** rowErrors: how many rows failed. */
  readonly count: number | null;
  readonly status: HintStatus;
  readonly note: string;
}

export interface HintState {
  readonly hintKey: string;
  readonly status: StoredHintStatus;
  readonly note: string;
  readonly updatedAt: string;
}

/** The engine's coverage hint in the shape of the hints table. */
export function fromCoverage(
  hint: MissingFileHint,
): Omit<ProjectHint, 'status' | 'note'> {
  return {
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

/** A table without a mapping (its data is not in the calculation) and files with row errors. */
export function fileHints(
  files: readonly ProjectFile[],
): Omit<ProjectHint, 'status' | 'note'>[] {
  const hints: Omit<ProjectHint, 'status' | 'note'>[] = [];
  for (const file of files) {
    const base = {
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
