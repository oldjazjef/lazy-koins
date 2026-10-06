import type { RateEntry } from '@lazykoins/engine';
import type { ProjectRate, RateKey } from '../domain/project-rate';

/** Persistence contract for a project's stored rates (F7.4). */
export abstract class ProjectRateRepositoryPort {
  /** Every stored rate, by kind, asset, currency, date, source. */
  abstract listByProject(projectId: string): Promise<ProjectRate[]>;

  /** Inserts or replaces (same kind, asset, currency, date, source); returns how many. */
  abstract upsertMany(
    projectId: string,
    entries: readonly RateEntry[],
  ): Promise<number>;

  /** Removes one stored rate; `false` when there was none. */
  abstract delete(projectId: string, key: RateKey): Promise<boolean>;
}
