import type { RateEntry } from '@lazykoins/engine';
import type {
  ProjectRate,
  RateKey,
  StoredRateEntry,
} from '../domain/project-rate';
import { ProjectRateRepositoryPort } from '../ports/project-rate.repository.port';
import {
  ChfPriceSourcePort,
  FxRateSourcePort,
  type SeriesRequest,
  UsdPriceSourcePort,
} from '../ports/rate-source.port';

const keyOf = (projectId: string, r: RateKey) =>
  `${projectId}|${r.kind}|${r.asset}|${r.currency}|${r.date}|${r.source}`;

/** Port double for handler specs: a real implementation over a Map. */
export class InMemoryProjectRateRepository extends ProjectRateRepositoryPort {
  readonly rows = new Map<string, ProjectRate>();
  private seq = 0;

  async listByProject(projectId: string): Promise<ProjectRate[]> {
    return [...this.rows.values()]
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => (keyOf(projectId, a) < keyOf(projectId, b) ? -1 : 1));
  }

  async upsertMany(
    projectId: string,
    entries: readonly StoredRateEntry[],
  ): Promise<number> {
    for (const entry of entries) {
      this.seq += 1;
      this.rows.set(keyOf(projectId, entry), {
        ...entry,
        note: entry.note ?? null,
        id: `r${this.seq}`,
        projectId,
        fetchedAt: '2026-01-01T00:00:00.000Z',
      });
    }
    return entries.length;
  }

  async delete(projectId: string, key: RateKey): Promise<boolean> {
    return this.rows.delete(keyOf(projectId, key));
  }
}

/** The window's ends and the 31.12. before its end — enough for a year-end lookup. */
function datesOf(from: string, to: string): string[] {
  return [from, `${Number(to.slice(0, 4)) - 1}-12-31`, to];
}

/** Fake rate sources: canned series, every call recorded — no network in tests. */
export class FakeUsdSource extends UsdPriceSourcePort {
  readonly name = 'binance' as const;
  readonly calls: SeriesRequest[] = [];
  /** Symbols whose request fails (network error). */
  readonly failFor = new Set<string>();

  constructor(private readonly prices: Readonly<Record<string, string>>) {
    super();
  }

  async dailyUsd(request: SeriesRequest): Promise<RateEntry[]> {
    this.calls.push(request);
    if (this.failFor.has(request.symbol)) {
      throw Object.assign(new Error('binance: request failed'), {
        status: null,
      });
    }
    const value = this.prices[request.symbol];
    if (value === undefined) return [];
    return datesOf(request.from, request.to).map((date) => ({
      kind: 'price',
      asset: request.asset,
      currency: 'USD',
      date,
      value,
      source: 'binance',
    }));
  }
}

export class FakeChfSource extends ChfPriceSourcePort {
  readonly name = 'coingecko' as const;
  readonly calls: (SeriesRequest & { coinId: string; apiKey: string })[] = [];
  /** Every request fails with this HTTP status (401 = key refused). */
  failWithStatus: number | undefined;

  async dailyChf(
    request: SeriesRequest & { coinId: string; apiKey: string },
  ): Promise<RateEntry[]> {
    this.calls.push(request);
    if (this.failWithStatus !== undefined) {
      throw Object.assign(new Error('coingecko: request failed'), {
        status: this.failWithStatus,
      });
    }
    return datesOf(request.from, request.to).map((date) => ({
      kind: 'price',
      asset: request.asset,
      currency: 'CHF',
      date,
      value: '1.5',
      source: 'coingecko',
    }));
  }
}

export class FakeFxSource extends FxRateSourcePort {
  readonly name = 'ecb' as const;
  readonly calls: string[] = [];

  async dailyChf(
    base: 'USD' | 'EUR',
    from: string,
    to: string,
  ): Promise<RateEntry[]> {
    this.calls.push(base);
    const value = base === 'USD' ? '0.8' : '0.93';
    return datesOf(from, to).map((date) => ({
      kind: 'fx',
      asset: base,
      currency: 'CHF',
      date,
      value,
      source: 'ecb',
    }));
  }
}
