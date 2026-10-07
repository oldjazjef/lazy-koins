import type { RateEntry } from '@lazykoins/engine';
import type {
  ProjectRate,
  RateKey,
  StoredRateEntry,
} from '../domain/project-rate';
import type {
  CoinCandidate,
  CoinProvider,
  MarketCoin,
} from '../domain/coin-choice';
import { CoinMarketRepositoryPort } from '../ports/coin-market.repository.port';
import { CoinDirectoryPort } from '../ports/coin-directory.port';
import { ProjectRateRepositoryPort } from '../ports/project-rate.repository.port';
import {
  FiatPriceSourcePort,
  FxRateSourcePort,
  type KeyCheckResult,
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

  async deleteFetchedPrices(projectId: string, asset: string): Promise<number> {
    let count = 0;
    for (const [key, row] of this.rows) {
      if (
        row.projectId === projectId &&
        row.kind === 'price' &&
        row.asset === asset &&
        row.source !== 'manual' &&
        row.source !== 'estv'
      ) {
        this.rows.delete(key);
        count += 1;
      }
    }
    return count;
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
        source: 'binance',
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

export class FakeFiatSource extends FiatPriceSourcePort {
  readonly name = 'coingecko' as const;
  readonly calls: (SeriesRequest & {
    coinId: string;
    apiKey: string;
    currency: string;
  })[] = [];
  /** Every request fails with this HTTP status (401 = key refused). */
  failWithStatus: number | undefined;

  async dailyFiat(
    request: SeriesRequest & {
      coinId: string;
      apiKey: string;
      currency: string;
    },
  ): Promise<RateEntry[]> {
    this.calls.push(request);
    if (this.failWithStatus !== undefined) {
      // Shaped like `RateSourceError` (source + status).
      throw Object.assign(new Error('coingecko: request failed'), {
        source: 'coingecko',
        status: this.failWithStatus,
      });
    }
    return datesOf(request.from, request.to).map((date) => ({
      kind: 'price',
      asset: request.asset,
      currency: request.currency,
      date,
      value: '1.5',
      source: 'coingecko',
    }));
  }

  async checkKey(apiKey: string): Promise<KeyCheckResult> {
    const ok = apiKey.startsWith('CG-');
    return {
      ok,
      ...(ok ? {} : { code: 'invalidKey' as const }),
      status: ok ? 200 : 401,
      providerMessage: ok ? null : 'invalid key',
      url: 'https://api.coingecko.com/api/v3/ping',
      millis: 1,
    };
  }
}

/** Fake coin directory ("Coin wählen"): a fixed list, calls recorded — no network in tests. */
export class FakeCoinDirectory extends CoinDirectoryPort {
  readonly providers: readonly CoinProvider[] = ['coingecko'];
  readonly calls: string[] = [];
  /** Every call fails with this HTTP status (e.g. 429). */
  failWithStatus: number | undefined;
  readonly coins: CoinCandidate[] = [
    {
      provider: 'coingecko',
      id: 'opinion',
      name: 'Opinion',
      symbol: 'OPN',
      marketCapRank: 1191,
    },
    {
      provider: 'coingecko',
      id: 'open-ticketing-ecosystem',
      name: 'OPEN Ticketing Ecosystem',
      symbol: 'OPN',
      marketCapRank: 3301,
    },
    {
      provider: 'coingecko',
      id: 'polkadot',
      name: 'Polkadot',
      symbol: 'DOT',
      marketCapRank: 20,
    },
  ];

  private fail(): void {
    if (this.failWithStatus !== undefined) {
      throw Object.assign(new Error('coingecko: request failed'), {
        source: 'coingecko',
        status: this.failWithStatus,
      });
    }
  }

  async search(
    _provider: CoinProvider,
    query: string,
    options: { readonly apiKey?: string; readonly limit: number },
  ): Promise<CoinCandidate[]> {
    this.calls.push(`search:${query}`);
    this.fail();
    const q = query.toLowerCase();
    return this.coins
      .filter(
        (c) =>
          c.symbol.toLowerCase() === q ||
          c.name.toLowerCase().includes(q) ||
          c.id === q,
      )
      .slice(0, options.limit);
  }

  async find(
    _provider: CoinProvider,
    id: string,
  ): Promise<CoinCandidate | undefined> {
    this.calls.push(`find:${id}`);
    this.fail();
    return this.coins.find((c) => c.id === id);
  }

  /** `<platform>:<address>` → coin id, for `byContract`. */
  readonly contracts = new Map<string, string>();

  async byContract(
    _provider: CoinProvider,
    platform: string,
    address: string,
  ): Promise<CoinCandidate | undefined> {
    this.calls.push(`contract:${platform}:${address}`);
    this.fail();
    const id = this.contracts.get(`${platform}:${address}`);
    return id ? this.coins.find((c) => c.id === id) : undefined;
  }

  /** The market list `topCoins` answers (empty by default). */
  market: MarketCoin[] = [];

  async topCoins(
    _provider: CoinProvider,
    count: number,
  ): Promise<MarketCoin[]> {
    this.calls.push(`top:${count}`);
    this.fail();
    return this.market.filter((c) => c.marketCapRank <= count);
  }
}

/** Port double: the deployment-wide market list over an array. */
export class InMemoryCoinMarketRepository extends CoinMarketRepositoryPort {
  rows: MarketCoin[] = [];
  at: string | null = null;

  async fetchedAt(): Promise<string | null> {
    return this.at;
  }

  async listBySymbols(
    provider: CoinProvider,
    symbols: readonly string[],
  ): Promise<MarketCoin[]> {
    return this.rows.filter(
      (r) => r.provider === provider && symbols.includes(r.symbol),
    );
  }

  async listShared(
    provider: CoinProvider,
    maxRank: number,
  ): Promise<MarketCoin[]> {
    const relevant = this.rows.filter(
      (r) => r.provider === provider && r.marketCapRank <= maxRank,
    );
    return relevant.filter(
      (r) => relevant.filter((o) => o.symbol === r.symbol).length > 1,
    );
  }

  async replace(
    _provider: CoinProvider,
    coins: readonly MarketCoin[],
    fetchedAt: string,
  ): Promise<void> {
    this.rows = [...coins];
    this.at = fetchedAt;
  }
}

export class FakeFxSource extends FxRateSourcePort {
  readonly name = 'ecb' as const;
  /** `USD` / `EUR` for a CHF project (as before), `USD>EUR` for another quote. */
  readonly calls: string[] = [];

  async daily(
    base: string,
    quote: string,
    from: string,
    to: string,
  ): Promise<RateEntry[]> {
    this.calls.push(quote === 'CHF' ? base : `${base}>${quote}`);
    const value =
      quote === 'CHF'
        ? base === 'USD'
          ? '0.8'
          : '0.93'
        : base === 'USD'
          ? '0.86'
          : '1.08';
    return datesOf(from, to).map((date) => ({
      kind: 'fx',
      asset: base,
      currency: quote,
      date,
      value,
      source: 'ecb',
    }));
  }
}
