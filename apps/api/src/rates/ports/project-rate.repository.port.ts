import type {
  ProjectRate,
  RateKey,
  StoredRateEntry,
} from '../domain/project-rate';

/** Persistence contract for a project's stored rates (F7.4). */
export abstract class ProjectRateRepositoryPort {
  /** Every stored rate, by kind, asset, currency, date, source. */
  abstract listByProject(projectId: string): Promise<ProjectRate[]>;

  /**
   * Inserts or replaces (same kind, asset, currency, date, source) — the value and the label
   * (`note`, absent = none); returns how many.
   */
  abstract upsertMany(
    projectId: string,
    entries: readonly StoredRateEntry[],
  ): Promise<number>;

  /** Removes one stored rate; `false` when there was none. */
  abstract delete(projectId: string, key: RateKey): Promise<boolean>;

  /**
   * Removes the **fetched** prices of `asset` (every source but `manual` and `estv`) — after a coin
   * was chosen for the symbol they may be another coin's (F7.4). Returns how many.
   */
  abstract deleteFetchedPrices(
    projectId: string,
    asset: string,
  ): Promise<number>;
}
