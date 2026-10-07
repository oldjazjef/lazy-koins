import {
  addDays,
  asRecord,
  checkRange,
  chunkDays,
  codeForStatus,
  DaySeries,
  PriceHttp,
  type PriceHttpAnswer,
  type PriceHttpOptions,
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
  type PriceSourceTestResult,
} from './price-history-source.port';

const BASE = 'https://api.coinpaprika.com/v1';
const CHUNK_DAYS = 365;

/**
 * CoinPaprika free plan (**no key**, personal use only): `GET /tickers/{id}/historical?interval=1d`
 * — one snapshot per UTC day at 00:00 (`startOfDay`), quote **USD** only (the other one is BTC).
 * The free plan serves the last **365 days**; an older `start` answers **402** "Getting daily
 * historical data before … is not allowed in this plan" → `planLacksHistory`. `end` is exclusive,
 * so the day after `to` is asked for. 20 000 calls a month, 10 requests/s per IP — spaced 0.5 s.
 */
export class CoinPaprikaSource extends PriceHistorySourcePort {
  readonly id = 'coinpaprika' as const;
  readonly capabilities: PriceSourceCapabilities = {
    label: 'CoinPaprika',
    key: 'none',
    quotes: ['USD'],
    freeHistoryDays: 365,
    coinRef: 'paprikaId',
    dayPoint: 'startOfDay',
    search: true,
    contractLookup: false,
    personalUseOnly: true,
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
        'CoinPaprika prices in USD only',
      );
    }
    if (!/^[a-z0-9-]{1,100}$/.test(request.coin)) {
      throw this.http.error('notFound', null, 'not a CoinPaprika id');
    }
    const today = this.http.today();
    const series = new DaySeries(request.from, request.to, 'first');
    for (const range of chunkDays(request.from, request.to, CHUNK_DAYS)) {
      const end = addDays(range.to, 1);
      const answer = await this.call(
        `${BASE}/tickers/${request.coin}/historical?start=${range.from}` +
          (end <= today ? `&end=${end}` : '') +
          `&interval=1d&quote=usd&limit=5000`,
      );
      if (!Array.isArray(answer.body)) {
        throw this.http.fail('badResponse', answer, [], 'not a list of ticks');
      }
      for (const tick of answer.body) {
        const record = asRecord(tick);
        const time = record?.['timestamp'];
        if (typeof time !== 'string') continue;
        const ms = Date.parse(time);
        if (!Number.isFinite(ms)) continue;
        series.add(new Date(ms).toISOString().slice(0, 10), record?.['price']);
      }
    }
    return series.toArray();
  }

  /** `GET /search?q=&c=currencies` (all plans). */
  async searchCoins(query: string): Promise<CoinCandidate[]> {
    const text = query.trim();
    if (text === '') return [];
    const answer = await this.call(
      `${BASE}/search?q=${encodeURIComponent(text)}&c=currencies&limit=25`,
    );
    const currencies = asRecord(answer.body)?.['currencies'];
    if (!Array.isArray(currencies)) return [];
    return rankCandidates(currencies.flatMap(candidateOf), text);
  }

  async resolveCoin(ref: {
    readonly symbol?: string;
    readonly contract?: ContractRef;
  }): Promise<CoinCandidate[]> {
    const symbol = ref.symbol?.trim() ?? '';
    if (ref.contract || symbol === '') return [];
    const found = await this.searchCoins(symbol);
    return found.filter(
      (candidate) => candidate.symbol.toUpperCase() === symbol.toUpperCase(),
    );
  }

  /** One daily tick of Bitcoin 360 days back — proves the API and the free depth. */
  test(): Promise<PriceSourceTestResult> {
    const start = addDays(this.http.today(), -360);
    const url = `${BASE}/tickers/btc-bitcoin/historical?start=${start}&interval=1d&limit=1`;
    return this.http.test(url, async () => {
      const answer = await this.call(url);
      if (!Array.isArray(answer.body)) {
        throw this.http.fail('badResponse', answer, [], 'not a list of ticks');
      }
      return {
        status: answer.status,
        historyDays: 365,
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
    if (answer.body === undefined) {
      throw this.http.fail('badResponse', answer, [], 'not JSON');
    }
    return answer;
  }
}

function candidateOf(raw: unknown): CoinCandidate[] {
  const record = asRecord(raw);
  const id = record?.['id'];
  const symbol = record?.['symbol'];
  if (typeof id !== 'string' || typeof symbol !== 'string') return [];
  const name = record?.['name'];
  return [
    {
      id,
      symbol,
      name: typeof name === 'string' ? name : null,
      rank: rankOf(record?.['rank']),
    },
  ];
}
