import {
  type CoverageEntry,
  type FileKind,
  looksLikeText,
  type Period,
} from '@lazykoins/engine';

/**
 * Files (F5). Hand-written domain types — never a re-export of a Prisma model.
 *
 * - **stored file** (= the user's file, F5.21): the original bytes, content-addressed by SHA-256
 *   per owner (F5.3, F5.4), and **how it is read** — in the standard format directly, through a
 *   mapping spec, not yet (needs a mapping), or kept as evidence only. One reading per file,
 *   whatever project uses it.
 * - **project file**: the selection of a stored file in one project (F5.22) — its name there,
 *   how it came in, and whether it is deactivated there (F5.7a). Its analysis fields are the
 *   stored file's.
 */

/** Mirrored by a CHECK in the migration. */
export const PROJECT_FILE_STATUSES = [
  'standard',
  'mapped',
  'needs_mapping',
  'evidence_only',
] as const;
export type ProjectFileStatus = (typeof PROJECT_FILE_STATUSES)[number];

/** Upload limit per file (F5.1). nginx allows 50 MB per request in front of it. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const MEDIA_TYPES: Readonly<Record<FileKind, string>> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export const UPLOADED = 'uploaded';
/** F5.22: picked from the user's files in "Dateien auswählen". */
export const SELECTED = 'selected';
export const FROM_PROJECT = 'from_project:';
/** A standard-format file the AI converted from another file of the project (a PDF statement). */
export const DERIVED_FROM = 'derived_from:';

export interface StoredFileMeta {
  readonly id: string;
  readonly ownerId: string;
  readonly sha256: string;
  readonly size: number;
  readonly mediaType: string;
  readonly kind: FileKind;
  readonly originalName: string;
  readonly createdAt: string;
}

export interface StoredFileContent extends StoredFileMeta {
  readonly bytes: Uint8Array;
}

/** What reading a file found out (the engine's result, summarised for storage). */
export interface FileAnalysis {
  readonly status: ProjectFileStatus;
  readonly importerId: string | null;
  readonly mappingId: string | null;
  readonly platform: string | null;
  readonly period: Period | null;
  readonly bookingCount: number;
  readonly holdingCount: number;
  readonly errorCount: number;
  readonly coverage: readonly CoverageEntry[];
}

export const NOT_ANALYSED: FileAnalysis = {
  status: 'needs_mapping',
  importerId: null,
  mappingId: null,
  platform: null,
  period: null,
  bookingCount: 0,
  holdingCount: 0,
  errorCount: 0,
  coverage: [],
};

export const EVIDENCE_ONLY: FileAnalysis = {
  ...NOT_ANALYSED,
  status: 'evidence_only',
};

export interface ProjectFile extends FileAnalysis {
  readonly id: string;
  readonly projectId: string;
  /** The stored file. */
  readonly fileId: string;
  readonly sha256: string;
  readonly kind: FileKind;
  readonly size: number;
  readonly mediaType: string;
  readonly displayName: string;
  /** `uploaded`, `from_project:<id>` or `derived_from:<project file id>` (F5.5 "Herkunft"). */
  readonly origin: string;
  readonly addedAt: string;
  /**
   * F5.7a: when the file was deactivated in this project (null = active). A deactivated file is
   * ignored by the calculation, the dashboard, the F5.8 hints, the checks and the exports; it
   * stays stored, downloadable and previewable, its mapping status is unchanged.
   */
  readonly disabledAt: string | null;
  /** Optional reason for the deactivation (≤ `FILE_NOTE_MAX`); null when active. */
  readonly disabledNote: string | null;
}

/** F5.21: one project that selects a stored file. */
export interface FileUsage {
  readonly projectFileId: string;
  readonly projectId: string;
  /** Not deactivated in that project (F5.7a). */
  readonly active: boolean;
}

/**
 * F5.21: a file of the user, independent of projects — its bytes' facts, how it is read and
 * which projects select it. `source`: `uploaded`, `derived_from:<stored file id>` (read from a
 * PDF by the AI) or `wallet:<wallet id>` (a wallet fetch).
 */
export interface UserFile extends StoredFileMeta, FileAnalysis {
  readonly source: string;
  readonly usages: readonly FileUsage[];
}

/** F5.7a: the longest deactivation note (mirrored by a CHECK in the migration). */
export const FILE_NOTE_MAX = 500;

/** F5.7a: a deactivation (when + optional note); `null` = active. */
export interface FileDeactivation {
  readonly at: string;
  readonly note: string | null;
}

/** The project file is active (not deactivated, F5.7a). */
export function isActive(file: Pick<ProjectFile, 'disabledAt'>): boolean {
  return file.disabledAt === null;
}

/**
 * The file contributes records to the project: read (standard format or a mapping) **and**
 * active (F5.7a). The one rule for calculation, dashboard, coverage hints, checks and exports.
 */
export function readsRecords(
  file: Pick<ProjectFile, 'status' | 'disabledAt'>,
): boolean {
  return (
    (file.status === 'standard' || file.status === 'mapped') && isActive(file)
  );
}

/** The project id inside a `from_project:<id>` origin, else `undefined`. */
export function originProjectId(origin: string): string | undefined {
  return origin.startsWith(FROM_PROJECT)
    ? origin.slice(FROM_PROJECT.length)
    : undefined;
}

/** The source project file inside a `derived_from:<id>` origin, else `undefined`. */
export function derivedFromId(origin: string): string | undefined {
  return origin.startsWith(DERIVED_FROM)
    ? origin.slice(DERIVED_FROM.length)
    : undefined;
}

/**
 * The file kind from the bytes themselves — never from the name or the Content-Type (F5.1):
 * `%PDF-` is a PDF; a ZIP container holding `xl/` parts is an XLSX; text is a CSV. Anything
 * else is refused.
 */
export function sniffFileKind(bytes: Uint8Array): FileKind | undefined {
  if (bytes.length === 0) return undefined;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // The local file headers of an XLSX name its parts; `xl/` appears near the start.
    const head = latin1(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
    return head.includes('xl/') ? 'xlsx' : undefined;
  }
  return looksLikeText(bytes) ? 'csv' : undefined;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** A safe display name: no directories, no control characters, at most 255 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, 255);
}
