import {
  type CoinCandidate,
  type ContractRef,
  type DailyPrice,
  type DailyPriceRequest,
  PriceHistorySourcePort,
  PriceHistorySourcesPort,
  PriceSourceError,
  type PriceSourceCapabilities,
  type PriceSourceErrorCode,
  type PriceSourceId,
  type PriceSourceTestResult,
} from '../../integrations/rates/price-history/price-history-source.port';
import { PriceHistorySources } from '../../integrations/rates/price-history/price-history-sources';

/** The real adapters' capabilities (no request is made by building them). */
const REAL = PriceHistorySources.real();

/** One recorded `daily` call. */
export interface FakeDailyCall extends DailyPriceRequest {
  readonly provider: PriceSourceId;
}

/**
 * A price-history provider double: the real adapter's capabilities, canned prices per coin
 * reference (`*` = any coin), canned symbol/contract lookups, an optional failure — every call
 * recorded, no network.
 */
export class FakeHistorySource extends PriceHistorySourcePort {
  readonly capabilities: PriceSourceCapabilities;
  /** Coin reference → price (every day of the window); `*` answers for any coin. */
  prices: Record<string, string> = {};
  /** Symbol → candidates `resolveCoin` answers. */
  readonly symbols = new Map<string, CoinCandidate[]>();
  /** `<network>:<address>` → candidates. */
  readonly contracts = new Map<string, CoinCandidate[]>();
  /** Every `daily` call fails with this code (and HTTP status). */
  failWith: { code: PriceSourceErrorCode; status: number | null } | undefined;
  /** Dates `daily` answers (default: the window's ends and the 31.12. before its end). */
  dates: ((from: string, to: string) => string[]) | undefined;
  readonly resolveCalls: string[] = [];
  testResult: Omit<PriceSourceTestResult, 'url' | 'millis'> = {
    ok: true,
    status: 200,
    historyDays: null,
    plan: 'Free',
    detail: null,
  };

  constructor(
    readonly id: PriceSourceId,
    private readonly owner: FakePriceHistorySources,
  ) {
    super();
    this.capabilities = REAL.byId(id).capabilities;
  }

  async daily(request: DailyPriceRequest): Promise<DailyPrice[]> {
    this.owner.calls.push({ ...request, provider: this.id });
    if (this.failWith) {
      throw new PriceSourceError(
        this.id,
        this.failWith.code,
        this.failWith.status,
        `${this.id} says no`,
      );
    }
    const value = this.prices[request.coin] ?? this.prices['*'];
    if (value === undefined) return [];
    const days = this.dates
      ? this.dates(request.from, request.to)
      : [
          request.from,
          `${Number(request.to.slice(0, 4)) - 1}-12-31`,
          request.to,
        ];
    return [...new Set(days)]
      .filter((d) => d >= request.from && d <= request.to)
      .sort()
      .map((date) => ({ date, value }));
  }

  async resolveCoin(ref: {
    readonly symbol?: string;
    readonly contract?: ContractRef;
  }): Promise<CoinCandidate[]> {
    if (ref.contract) {
      const key = `${ref.contract.network}:${ref.contract.address}`;
      this.resolveCalls.push(`contract:${key}`);
      return this.contracts.get(key) ?? [];
    }
    const symbol = (ref.symbol ?? '').toUpperCase();
    this.resolveCalls.push(`symbol:${symbol}`);
    return this.symbols.get(symbol) ?? [];
  }

  async test(apiKey?: string): Promise<PriceSourceTestResult> {
    return {
      ...this.testResult,
      detail:
        this.testResult.detail ??
        (apiKey ? `checked with key ${apiKey}` : null),
      url: `https://${this.id}.example/test`,
      millis: 1,
    };
  }
}

/** Every provider as a `FakeHistorySource`; `calls` = every `daily` call in order. */
export class FakePriceHistorySources extends PriceHistorySourcesPort {
  readonly calls: FakeDailyCall[] = [];
  private readonly sources = new Map<PriceSourceId, FakeHistorySource>();

  constructor() {
    super();
    for (const source of REAL.all()) {
      this.sources.set(source.id, new FakeHistorySource(source.id, this));
    }
    // As the old CoinGecko double: any coin costs 1.5 in the asked currency.
    this.fake('coingecko').prices = { '*': '1.5' };
  }

  fake(id: PriceSourceId): FakeHistorySource {
    const source = this.sources.get(id);
    if (!source) throw new RangeError(id);
    return source;
  }

  callsOf(id: PriceSourceId): FakeDailyCall[] {
    return this.calls.filter((c) => c.provider === id);
  }

  all(): readonly PriceHistorySourcePort[] {
    return [...this.sources.values()];
  }

  byId(id: PriceSourceId): PriceHistorySourcePort {
    return this.fake(id);
  }
}
