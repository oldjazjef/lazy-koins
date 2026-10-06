import type { CorrectionData, RecordSummary } from '@lazykoins/engine';
import type {
  NewSnapshot,
  OpenItemState,
  ProjectFigures,
  Snapshot,
  SnapshotMeta,
  StoredCorrection,
} from '../domain/calculation';

/**
 * Calculation snapshots (F7.6). Only the latest few are kept per project; the project list reads
 * the headline figures of the latest one (F4.2).
 */
export abstract class CalculationSnapshotRepositoryPort {
  abstract save(
    projectId: string,
    snapshot: NewSnapshot,
  ): Promise<SnapshotMeta>;

  abstract latest(projectId: string): Promise<Snapshot | undefined>;

  /** The records behind a snapshot's figures (F7.5). */
  abstract records(
    snapshotId: string,
  ): Promise<Readonly<Record<string, RecordSummary>> | undefined>;

  /** Headline figures of the latest snapshot per project (absent = never calculated). */
  abstract latestFigures(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectFigures>>;
}

/** Corrections (F9.4): created, undone and redone — never deleted. */
export abstract class CorrectionRepositoryPort {
  /** The project's corrections, oldest first, undone ones included. */
  abstract listByProject(projectId: string): Promise<StoredCorrection[]>;

  abstract findById(id: string): Promise<StoredCorrection | undefined>;

  abstract create(
    projectId: string,
    input: { readonly data: CorrectionData; readonly reason: string },
  ): Promise<StoredCorrection>;

  /** Sets or clears `undoneAt`; `undefined` when the correction is gone. */
  abstract setUndone(
    id: string,
    undone: boolean,
  ): Promise<StoredCorrection | undefined>;
}

/** Ticks and notes on open items (F8.2), keyed by the item's stable key. */
export abstract class OpenItemStateRepositoryPort {
  abstract listByProject(projectId: string): Promise<OpenItemState[]>;

  abstract save(
    projectId: string,
    itemKey: string,
    changes: { readonly done?: boolean; readonly note?: string },
  ): Promise<OpenItemState>;
}
