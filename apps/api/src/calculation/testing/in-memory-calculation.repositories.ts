import type { CorrectionData, RecordSummary } from '@lazykoins/engine';
import type {
  NewSnapshot,
  OpenItemState,
  ProjectFigures,
  Snapshot,
  SnapshotMeta,
  StoredCorrection,
} from '../domain/calculation';
import {
  CalculationSnapshotRepositoryPort,
  CorrectionRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../ports/calculation.repository.port';

/** A deterministic clock for the doubles: one second per call. */
class Clock {
  private value = Date.parse('2026-01-01T00:00:00.000Z');

  next(): string {
    this.value += 1000;
    return new Date(this.value).toISOString();
  }
}

/** Port double: snapshots over a Map (JSON round trip, like the database). */
export class InMemorySnapshotRepository extends CalculationSnapshotRepositoryPort {
  readonly rows: (Snapshot & { records: string })[] = [];
  private readonly clock = new Clock();
  private seq = 0;

  async save(projectId: string, snapshot: NewSnapshot): Promise<SnapshotMeta> {
    this.seq += 1;
    const meta: SnapshotMeta = {
      id: `s${this.seq}`,
      projectId,
      inputHash: snapshot.inputHash,
      engineVersion: snapshot.engineVersion,
      wealthChf: snapshot.result.totals.wealthChf,
      incomeChf: snapshot.result.totals.incomeChf,
      createdAt: this.clock.next(),
    };
    this.rows.push({
      ...meta,
      result: JSON.parse(JSON.stringify(snapshot.result)),
      records: JSON.stringify(snapshot.records),
    });
    return meta;
  }

  async latest(projectId: string): Promise<Snapshot | undefined> {
    const row = [...this.rows].reverse().find((r) => r.projectId === projectId);
    if (!row) return undefined;
    const { records: _records, ...snapshot } = row;
    return snapshot;
  }

  async records(
    snapshotId: string,
  ): Promise<Readonly<Record<string, RecordSummary>> | undefined> {
    const row = this.rows.find((r) => r.id === snapshotId);
    return row ? JSON.parse(row.records) : undefined;
  }

  async latestFigures(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectFigures>> {
    const out = new Map<string, ProjectFigures>();
    for (const id of projectIds) {
      const latest = await this.latest(id);
      if (latest) {
        out.set(id, {
          wealthChf: latest.wealthChf,
          incomeChf: latest.incomeChf,
          calculatedAt: latest.createdAt,
        });
      }
    }
    return out;
  }
}

export class InMemoryCorrectionRepository extends CorrectionRepositoryPort {
  readonly rows = new Map<string, StoredCorrection>();
  private readonly clock = new Clock();
  private seq = 0;

  async listByProject(projectId: string): Promise<StoredCorrection[]> {
    return [...this.rows.values()].filter((c) => c.projectId === projectId);
  }

  async findById(id: string): Promise<StoredCorrection | undefined> {
    return this.rows.get(id);
  }

  async create(
    projectId: string,
    input: { readonly data: CorrectionData; readonly reason: string },
  ): Promise<StoredCorrection> {
    this.seq += 1;
    const correction: StoredCorrection = {
      id: `c${this.seq}`,
      projectId,
      type: input.data.type,
      data: input.data,
      reason: input.reason,
      createdAt: this.clock.next(),
      undoneAt: null,
    };
    this.rows.set(correction.id, correction);
    return correction;
  }

  async setUndone(
    id: string,
    undone: boolean,
  ): Promise<StoredCorrection | undefined> {
    const existing = this.rows.get(id);
    if (!existing) return undefined;
    const updated = {
      ...existing,
      undoneAt: undone ? this.clock.next() : null,
    };
    this.rows.set(id, updated);
    return updated;
  }
}

export class InMemoryOpenItemStateRepository extends OpenItemStateRepositoryPort {
  readonly rows = new Map<string, OpenItemState & { projectId: string }>();

  async listByProject(projectId: string): Promise<OpenItemState[]> {
    return [...this.rows.values()]
      .filter((s) => s.projectId === projectId)
      .map(({ projectId: _p, ...state }) => state);
  }

  async save(
    projectId: string,
    itemKey: string,
    changes: { readonly done?: boolean; readonly note?: string },
  ): Promise<OpenItemState> {
    const key = `${projectId}|${itemKey}`;
    const current = this.rows.get(key);
    const next = {
      projectId,
      itemKey,
      done: changes.done ?? current?.done ?? false,
      note: changes.note ?? current?.note ?? '',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(key, next);
    const { projectId: _p, ...state } = next;
    return state;
  }
}
