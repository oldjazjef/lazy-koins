import {
  addDays,
  asRecord,
  chunkDays,
  checkRange,
  DaySeries,
  PriceHttp,
  type PriceHttpAnswer,
  type PriceHttpOptions,
  providerMessageOf,
  rankCandidates,
  rankOf,
} from './price-history-http';
import {
  type CoinCandidate,
  type ContractRef,
  type DailyPrice,
  type DailyPriceRequest,
  PriceHistorySourcePort,
  type PriceSourceCapabilities,
  type PriceSourceErrorCode,
  type PriceSourceTestResult,
} from './price-history-source.port';

const BASE = 'https://pro-api.coinmarketcap.com';
/** Days per historical request: 1 credit per 100 points, so a year costs 4 credits. */
const CHUNK_DAYS = 366;

/** CMC `status.error_code` → our code (docs: Errors and Rate Limits). */
const ERROR_CODES: Record<string, PriceSourceErrorCode> = {
  '1001': 'invalidKey', // API_KEY_INVALID
  '1002': 'invalidKey', // API_KEY_MISSING
  '1003': 'invalidKey', // API_KEY_PLAN_REQUIRES_PAYMENT (not activated)
  '1004': 'invalidKey', // API_KEY_PLAN_PAYMENT_EXPIRED
  '1005': 'invalidKey', // API_KEY_REQUIRED
  '1006': 'planLacksHistory', // API_KEY_PLAN_NOT_AUTHORIZED
  '1007': 'invalidKey', // API_KEY_DISABLED
  '1008': 'rateLimited',
  '1009': 'rateLimited',
  '1010': 'rateLimited',
  '1011': 'rateLimited',
};

/** App networks whose contract addresses `/v2/cryptocurrency/info?address=` can look up. */
const KNOWN_NETWORKS = new Set([
  'ethereum',
  'bsc',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'solana',
]);

/**
 * CoinMarketCap Pro API with the user's key (`X-CMC_PRO_API_KEY`). Daily history comes from
 * `GET /v3/cryptocurrency/quotes/historical?interval=daily` — on the free **Basic** plan for the
 * last 365 days (Builder 3 years, Startup+ since 2010); a request beyond the plan answers 403 with
 * `error_code` 1006 or a 400 naming the plan → `planLacksHistory`. `interval=daily` returns the
 * first quote of each UTC day (≈ 00:00), `convert` takes the quote currency (Basic: one per call).
 * Basic allows 50 calls a minute — calls are spaced 1.5 s apart.
 */
export class CoinMarketCapSource extends PriceHistorySourcePort {
  readonly id = 'coinmarketcap' as const;
  readonly capabilities: PriceSourceCapabilities = {
    label: 'CoinMarketCap',
    key: 'required',
    quotes: 'anyFiat',
    freeHistoryDays: 365,
    coinRef: 'cmcId',
    dayPoint: 'startOfDay',
    search: true,
    contractLookup: true,
    personalUseOnly: false,
    attribution: 'Data provided by CoinMarketCap.com',
  };
  private readonly http: PriceHttp;

  constructor(options: PriceHttpOptions = {}) {
    super();
    this.http = new PriceHttp(this.id, { spacingMs: 1500, ...options });
  }

  async daily(request: DailyPriceRequest): Promise<DailyPrice[]> {
    checkRange(request.from, request.to);
    const key = this.requireKey(request.apiKey);
    if (!/^\d+$/.test(request.coin)) {
      throw this.http.error('notFound', null, 'a CoinMarketCap id is a number');
    }
    const quote = request.quote.toUpperCase();
    const series = new DaySeries(request.from, request.to, 'first');
    for (const range of chunkDays(request.from, request.to, CHUNK_DAYS)) {
      const url =
        `${BASE}/v3/cryptocurrency/quotes/historical?id=${encodeURIComponent(request.coin)}` +
        `&time_start=${range.from}T00:00:00Z&time_end=${range.to}T23:59:59Z` +
        `&interval=daily&count=10000&convert=${encodeURIComponent(quote)}`;
      const answer = await this.call(url, key);
      const quotes = quotesOf(answer.body, request.coin);
      if (quotes === undefined) {
        throw this.http.fail('notFound', answer, [key], 'no data for this id');
      }
      for (const point of quotes) {
        const record = asRecord(point);
        const time = record?.['timestamp'];
        const value = asRecord(asRecord(record?.['quote'])?.[quote]);
        if (typeof time !== 'string' || !value) continue;
        const ms = Date.parse(time);
        if (!Number.isFinite(ms)) continue;
        series.add(new Date(ms).toISOString().slice(0, 10), value['price']);
      }
    }
    return series.toArray();
  }

  /** Symbol search over the id map (`/v1/cryptocurrency/map?symbol=`, no credits). */
  async searchCoins(query: string, apiKey?: string): Promise<CoinCandidate[]> {
    return this.resolveCoin({ symbol: query }, apiKey);
  }

  async resolveCoin(
    ref: { readonly symbol?: string; readonly contract?: ContractRef },
    apiKey?: string,
  ): Promise<CoinCandidate[]> {
    const key = this.requireKey(apiKey);
    if (ref.contract) return this.byContract(ref.contract, key);
    const symbol = ref.symbol?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9.$-]{1,20}$/.test(symbol)) return [];
    const answer = await this.lookup(
      `${BASE}/v1/cryptocurrency/map?symbol=${encodeURIComponent(symbol)}&listing_status=active,inactive`,
      key,
    );
    if (!answer) return [];
    const data = asRecord(answer.body)?.['data'];
    if (!Array.isArray(data)) return [];
    return rankCandidates(data.flatMap(candidateOf), symbol);
  }

  /**
   * `GET /v1/key/info` (free of credits: plan limits + usage), then one daily quote of Bitcoin
   * 360 days back (1 credit) and, if that works, 1090 days back — so the result tells Basic
   * (365 days) from Builder or higher (≥ 1095).
   */
  test(apiKey?: string): Promise<PriceSourceTestResult> {
    const url = `${BASE}/v1/key/info`;
    return this.http.test(url, async () => {
      const key = this.requireKey(apiKey);
      const info = await this.call(url, key);
      const data = asRecord(asRecord(info.body)?.['data']);
      const plan = asRecord(data?.['plan']);
      const credits = plan?.['credit_limit_monthly'];
      const perMinute = plan?.['rate_limit_minute'];
      const planText =
        [
          typeof credits === 'string' ? `${credits} credits/month` : null,
          typeof perMinute === 'string' ? `${perMinute}/min` : null,
        ]
          .filter((part) => part !== null)
          .join(', ') || null;
      let historyDays: number | null = null;
      let detail: string | null = null;
      if (await this.reaches(360, key)) {
        historyDays = 365;
        if (await this.reaches(1090, key)) historyDays = 1095;
      } else {
        detail = 'the key works, but its plan has no daily history';
      }
      return {
        ...(historyDays === null
          ? { ok: false, code: 'planLacksHistory' as const }
          : {}),
        status: info.status,
        historyDays,
        plan: planText,
        detail,
      };
    }, [apiKey]);
  }

  private async reaches(daysBack: number, key: string): Promise<boolean> {
    const day = addDays(this.http.today(), -daysBack);
    try {
      const series = await this.daily({
        coin: '1',
        quote: 'USD',
        from: day,
        to: day,
        apiKey: key,
      });
      return series.length > 0;
    } catch (error) {
      if ((error as { code?: unknown }).code === 'planLacksHistory') {
        return false;
      }
      throw error;
    }
  }

  private async byContract(
    contract: ContractRef,
    key: string,
  ): Promise<CoinCandidate[]> {
    if (!KNOWN_NETWORKS.has(contract.network)) return [];
    if (!/^[A-Za-z0-9]{20,64}$/.test(contract.address.replace(/^0x/, ''))) {
      return [];
    }
    const answer = await this.lookup(
      `${BASE}/v2/cryptocurrency/info?address=${encodeURIComponent(contract.address)}&skip_invalid=true`,
      key,
    );
    if (!answer) return [];
    const data = asRecord(asRecord(answer.body)?.['data']);
    if (!data) return [];
    return rankCandidates(
      Object.values(data).flatMap((entry) =>
        Array.isArray(entry) ? entry.flatMap(candidateOf) : candidateOf(entry),
      ),
    );
  }

  /** A lookup GET: `undefined` when CMC does not know the symbol/address. */
  private async lookup(
    url: string,
    key: string,
  ): Promise<PriceHttpAnswer | undefined> {
    try {
      return await this.call(url, key, true);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'notFound') return undefined;
      throw error;
    }
  }

  private requireKey(apiKey: string | undefined): string {
    const key = apiKey?.trim();
    if (!key) {
      throw this.http.error(
        'invalidKey',
        null,
        'CoinMarketCap needs an API key',
      );
    }
    return key;
  }

  /**
   * One GET with the key; any CMC error becomes a `PriceSourceError`. `lookup`: a 400 (CMC's
   * answer to a symbol/address it does not know) is `notFound`.
   */
  private async call(
    url: string,
    key: string,
    lookup = false,
  ): Promise<PriceHttpAnswer> {
    const answer = await this.http.get(url, { 'X-CMC_PRO_API_KEY': key }, [
      key,
    ]);
    const errorCode = asRecord(asRecord(answer.body)?.['status'])?.[
      'error_code'
    ];
    const cmcCode =
      typeof errorCode === 'string' && errorCode !== '0' ? errorCode : null;
    if (answer.status >= 200 && answer.status < 300 && cmcCode === null) {
      if (answer.body === undefined) {
        throw this.http.fail('badResponse', answer, [key], 'not JSON');
      }
      return answer;
    }
    const mapped = cmcCode === null ? undefined : ERROR_CODES[cmcCode];
    if (mapped) throw this.http.fail(mapped, answer, [key]);
    const message = providerMessageOf(answer) ?? '';
    if (answer.status === 400) {
      if (/plan|subscription|upgrade/i.test(message)) {
        throw this.http.fail('planLacksHistory', answer, [key]);
      }
      if (lookup || /invalid value|not found|invalid id/i.test(message)) {
        throw this.http.fail('notFound', answer, [key]);
      }
      throw this.http.fail('badResponse', answer, [key]);
    }
    if (answer.status === 401)
      throw this.http.fail('invalidKey', answer, [key]);
    if (answer.status === 402 || answer.status === 403) {
      throw this.http.fail(
        /plan|subscription/i.test(message) &&
          !/expired|activated/i.test(message)
          ? 'planLacksHistory'
          : 'invalidKey',
        answer,
        [key],
      );
    }
    if (answer.status === 404) throw this.http.fail('notFound', answer, [key]);
    if (answer.status === 429)
      throw this.http.fail('rateLimited', answer, [key]);
    throw this.http.fail('badResponse', answer, [key]);
  }
}

/**
 * `data` of the historical quotes: keyed by id (`{ "1": { quotes } }`), or an array of such
 * entries; `undefined` when the coin is not in it at all.
 */
function quotesOf(body: unknown, id: string): unknown[] | undefined {
  const data = asRecord(body)?.['data'];
  const entries: unknown[] = Array.isArray(data)
    ? data
    : Object.values(asRecord(data) ?? {});
  for (const raw of entries) {
    const record = asRecord(Array.isArray(raw) ? raw[0] : raw);
    if (!record || record['id'] !== id) continue;
    const quotes = record['quotes'];
    return Array.isArray(quotes) ? quotes : [];
  }
  return undefined;
}

function candidateOf(raw: unknown): CoinCandidate[] {
  const record = asRecord(raw);
  const id = record?.['id'];
  const symbol = record?.['symbol'];
  if (
    typeof id !== 'string' ||
    !/^\d+$/.test(id) ||
    typeof symbol !== 'string'
  ) {
    return [];
  }
  const name = record?.['name'];
  return [
    {
      id,
      symbol,
      name: typeof name === 'string' ? name : null,
      rank: rankOf(record?.['rank'] ?? record?.['cmc_rank']),
    },
  ];
}
