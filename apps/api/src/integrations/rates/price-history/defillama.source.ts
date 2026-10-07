import {
  asRecord,
  checkRange,
  chunkDays,
  codeForStatus,
  DAY_MS,
  dayStart,
  DaySeries,
  PriceHttp,
  type PriceHttpAnswer,
  type PriceHttpOptions,
  utcDay,
} from './price-history-http';
import {
  type CoinCandidate,
  type ContractRef,
  type DailyPrice,
  type DailyPriceRequest,
  PriceHistorySourcePort,
  type PriceSourceCapabilities,
  type PriceSourceTestResult,
} from './price-history-source.port';

const BASE = 'https://coins.llama.fi';
const CHUNK_DAYS = 365;
/** A point further than this from a day boundary is no end-of-day value. */
const MAX_OFFSET_S = 6 * 3600;

/** App network → DefiLlama chain prefix. */
const CHAINS: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'bsc',
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base',
  solana: 'solana',
};

/**
 * DefiLlama coins API (free, **no key**): `GET /chart/{coin}?start=&span=&period=1d` — USD only.
 * A coin is `coingecko:<id>` or `<chain>:<address>` (tokens by contract, also ones CoinGecko does
 * not list). Points sit at the **end** of each UTC day (`timestamp` ≈ 23:59:59), so each is
 * filed under the day whose end it is nearest to; today's (unfinished) day is dropped. Rate
 * limits are not published — calls are spaced 0.5 s apart.
 */
export class DefiLlamaSource extends PriceHistorySourcePort {
  readonly id = 'defillama' as const;
  readonly capabilities: PriceSourceCapabilities = {
    label: 'DefiLlama',
    key: 'none',
    quotes: ['USD'],
    freeHistoryDays: null,
    coinRef: 'llamaCoin',
    dayPoint: 'close',
    search: false,
    contractLookup: true,
    personalUseOnly: false,
    attribution: null,
  };
  private readonly http: PriceHttp;

  constructor(options: PriceHttpOptions = {}) {
    super();
    this.http = new PriceHttp(this.id, { spacingMs: 500, ...options });
  }

  async daily(request: DailyPriceRequest): Promise<DailyPrice[]> {
    checkRange(request.from, request.to);
    if (request.quote.toUpperCase() !== 'USD') {
      throw this.http.error(
        'unsupportedQuote',
        null,
        'DefiLlama prices in USD only',
      );
    }
    const coin = coinKey(request.coin);
    if (!coin)
      throw this.http.error('notFound', null, 'not a DefiLlama coin key');
    const series = new DaySeries(
      request.from,
      request.to,
      'last',
      this.http.today(),
    );
    for (const range of chunkDays(request.from, request.to, CHUNK_DAYS)) {
      // The first point is the end of `range.from`, i.e. just before the next midnight.
      const start = (dayStart(range.from) + DAY_MS) / 1000;
      const span =
        Math.round((dayStart(range.to) - dayStart(range.from)) / DAY_MS) + 1;
      const answer = await this.call(
        `${BASE}/chart/${encodeURIComponent(coin)}?start=${start}&span=${span}&period=1d&searchWidth=600`,
      );
      const entry = asRecord(
        asRecord(asRecord(answer.body)?.['coins'])?.[coin],
      );
      // `{"coins":{}}` = an unknown coin or no price in this range — DefiLlama does not say
      // which, so both are an empty series (the caller falls back to the next source).
      if (!entry) continue;
      const prices = entry['prices'];
      if (!Array.isArray(prices)) {
        throw this.http.fail('badResponse', answer, [], 'no prices');
      }
      for (const point of prices) {
        const record = asRecord(point);
        const seconds = Number(record?.['timestamp']);
        if (!Number.isFinite(seconds)) continue;
        const boundary = Math.round(seconds / 86_400) * 86_400;
        if (Math.abs(seconds - boundary) > MAX_OFFSET_S) continue;
        series.add(utcDay(boundary * 1000 - 1), record?.['price']);
      }
    }
    return series.toArray();
  }

  /** A contract → its DefiLlama key, if DefiLlama prices it (`/prices/current/{chain}:{address}`). */
  async resolveCoin(ref: {
    readonly symbol?: string;
    readonly contract?: ContractRef;
  }): Promise<CoinCandidate[]> {
    if (!ref.contract) return [];
    const chain = CHAINS[ref.contract.network];
    if (
      !chain ||
      !/^[A-Za-z0-9]{20,64}$/.test(ref.contract.address.replace(/^0x/, ''))
    ) {
      return [];
    }
    const key = `${chain}:${ref.contract.address}`;
    const answer = await this.call(
      `${BASE}/prices/current/${encodeURIComponent(key)}`,
    );
    const coins = asRecord(asRecord(answer.body)?.['coins']) ?? {};
    return Object.entries(coins).flatMap(([id, raw]) => {
      const symbol = asRecord(raw)?.['symbol'];
      return typeof symbol === 'string'
        ? [{ id, symbol: symbol.toUpperCase(), name: null, rank: null }]
        : [];
    });
  }

  /** Bitcoin's current price — proves the API answers (no key to check). */
  test(): Promise<PriceSourceTestResult> {
    const url = `${BASE}/prices/current/coingecko:bitcoin`;
    return this.http.test(url, async () => {
      const answer = await this.call(url);
      const found = asRecord(asRecord(answer.body)?.['coins'])?.[
        'coingecko:bitcoin'
      ];
      if (!found)
        throw this.http.fail('badResponse', answer, [], 'no price for bitcoin');
      return {
        status: answer.status,
        historyDays: null,
        plan: 'Free',
        detail: null,
      };
    });
  }

  private async call(url: string): Promise<PriceHttpAnswer> {
    const answer = await this.http.get(url);
    const code = codeForStatus(answer.status);
    if (code === 'invalidKey') throw this.http.fail('badResponse', answer);
    if (code !== null) throw this.http.fail(code, answer);
    if (answer.body === undefined)
      throw this.http.fail('badResponse', answer, [], 'not JSON');
    return answer;
  }
}

/** `coingecko:<id>` or `<chain>:<address>`; a bare CoinGecko id is accepted too. */
function coinKey(coin: string): string | undefined {
  const text = coin.trim();
  if (/^[a-z0-9-]+:[A-Za-z0-9-]{1,100}$/.test(text)) return text;
  if (/^[a-z0-9-]{1,100}$/.test(text)) return `coingecko:${text}`;
  return undefined;
}
