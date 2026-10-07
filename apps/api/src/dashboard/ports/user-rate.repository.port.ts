import type { RateEntry } from '@lazykoins/engine';

/**
 * The user's own rate cache (F11.4): daily series fetched for the dashboard over any period.
 * Only the dashboard reads it — a project's calculation reads its own stored rates (F7.4).
 */
export abstract class UserRateRepositoryPort {
  abstract listByUser(userId: string): Promise<RateEntry[]>;

  /** Inserts or replaces fetched entries (`manual`/`estv` are refused); returns how many. */
  abstract upsertMany(
    userId: string,
    entries: readonly RateEntry[],
  ): Promise<number>;

  /**
   * Removes every cached price of `asset` (any source) — a coin chosen for the symbol makes them
   * possibly another coin's (F7.4). Returns how many.
   */
  abstract deletePrices(userId: string, asset: string): Promise<number>;
}
