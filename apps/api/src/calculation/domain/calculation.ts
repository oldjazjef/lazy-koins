import type {
  CalculationResult,
  CorrectionData,
  CorrectionType,
  RecordSummary,
} from '@lazykoins/engine';

/**
 * The calculation of a project (F7), its corrections (F9) and the state of its open items
 * (F8.2). Hand-written domain types — never a re-export of a Prisma model.
 */

/** A stored result without its records (those are read for drill-downs only). */
export type StoredResult = Omit<CalculationResult, 'records'>;

export interface SnapshotMeta {
  readonly id: string;
  readonly projectId: string;
  /** SHA-256 of the calculation's input (files, mappings, corrections, rates, previous year). */
  readonly inputHash: string;
  readonly engineVersion: number;
  readonly wealthChf: string;
  readonly incomeChf: string;
  readonly createdAt: string;
}

export interface Snapshot extends SnapshotMeta {
  readonly result: StoredResult;
}

export interface NewSnapshot {
  readonly inputHash: string;
  readonly engineVersion: number;
  readonly result: StoredResult;
  readonly records: Readonly<Record<string, RecordSummary>>;
}

/** The headline figures of a project's latest calculation (F4.2). */
export interface ProjectFigures {
  readonly wealthChf: string;
  readonly incomeChf: string;
  readonly calculatedAt: string;
}

/** Mirrored by a CHECK in the migration. */
export const STORED_CORRECTION_TYPES = [
  'price_override',
  'reclassify',
  'manual_booking',
  'manual_holding',
] as const satisfies readonly CorrectionType[];

export interface StoredCorrection {
  readonly id: string;
  readonly projectId: string;
  readonly type: CorrectionType;
  readonly data: CorrectionData;
  readonly reason: string;
  readonly createdAt: string;
  /** Set when undone (F9.4); the row stays as history. */
  readonly undoneAt: string | null;
}

export interface OpenItemState {
  readonly itemKey: string;
  readonly done: boolean;
  readonly note: string;
  readonly updatedAt: string;
}

/** A project file as the calculation names it (F7.5: figure → file + row). */
export interface FileRef {
  readonly projectFileId: string;
  readonly sha256: string;
  readonly displayName: string;
}
