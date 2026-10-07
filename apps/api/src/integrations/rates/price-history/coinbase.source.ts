import {
  checkRange,
  chunkDays,
  DaySeries,
  PriceHttp,
  type PriceHttpAnswer,
  type PriceHttpOptions,
  utcDay,
} from './price-history-http';
import {
  type DailyPrice,
  type DailyPriceRequest,
  PriceHistorySourcePort,
  type PriceSourceCapabilities,
  type PriceSourceTestResult,
} from './price-history-source.port';

const BASE = 'https://api.exchange.coinbase.com';
const QUOTES = ['USD', 'EUR', 'GBP'] as const;
/** Coinbase answers at most 300 candles per request (start and end both inclusive). */
const CHUNK_DAYS = 300;

/**
 * Coinbase Exchange public candles (no key): `GET /products/<BASE>-<QUOTE>/candles?granularity=86400`
 * — the **close** of each UTC day (`[time, low, high, open, close, volume]`, newest first), full
 * history since listing, 300 candles per call. An unknown product answers 404 `NotFound`. A
 * `User-Agent` is required. Today's unfinished candle is dropped. No CHF pairs. Spaced 0.35 s.
 */
export class CoinbaseSource extends PriceHistorySourcePort {
  readonly id = 'coinbase' as const;
  readonly capabilities: PriceSourceCapabilities = {
    label: 'Coinbase',
    key: 'none',
    quotes: QUOTES,
    freeHistoryDays: null,
    coinRef: 'ticker',
    dayPoint: 'close',
    search: false,
    contractLookup: false,
    personalUseOnly: false,
    attribution: null,
  };
  private readonly http: PriceHttp;

  constructor(options: PriceHttpOptions = {}) {
    super();
    this.http = new PriceHttp(this.id, { spacingMs: 350, ...options });
  }

  async daily(request: DailyPriceRequest): Promise<DailyPrice[]> {
    checkRange(request.from, request.to);
    const quote = request.quote.toUpperCase();
    if (!(QUOTES as readonly string[]).includes(quote)) {
      throw this.http.error(
        'unsupportedQuote',
        null,
        `no ${quote} pairs on Coinbase`,
      );
    }
    const ticker = request.coin.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) {
      throw this.http.error('notFound', null, 'not a ticker');
    }
    const series = new DaySeries(
      request.from,
      request.to,
      'last',
      this.http.today(),
    );
    for (const range of chunkDays(request.from, request.to, CHUNK_DAYS)) {
      const answer = await this.call(
        `${BASE}/products/${ticker}-${quote}/candles?granularity=86400` +
          `&start=${range.from}T00:00:00Z&end=${range.to}T00:00:00Z`,
      );
      if (!Array.isArray(answer.body)) {
        throw this.http.fail(
          'badResponse',
          answer,
          [],
          'not a list of candles',
        );
      }
      for (const candle of answer.body) {
        if (!Array.isArray(candle)) continue;
        const seconds = Number(candle[0]);
        if (!Number.isFinite(seconds)) continue;
        series.add(utcDay(seconds * 1000), candle[4]);
      }
    }
    return series.toArray();
  }

  /** `GET /time` — the API answers. */
  test(): Promise<PriceSourceTestResult> {
    const url = `${BASE}/time`;
    return this.http.test(url, async () => {
      const answer = await this.call(url);
      return {
        status: answer.status,
        historyDays: null,
        plan: 'Public',
        detail: null,
      };
    });
  }

  private async call(url: string): Promise<PriceHttpAnswer> {
    const answer = await this.http.get(url, { 'user-agent': 'lazy-koins' });
    if (answer.status === 404) throw this.http.fail('notFound', answer);
    if (answer.status === 429) throw this.http.fail('rateLimited', answer);
    if (answer.status < 200 || answer.status >= 300) {
      throw this.http.fail('badResponse', answer);
    }
    if (answer.body === undefined) {
      throw this.http.fail('badResponse', answer, [], 'not JSON');
    }
    return answer;
  }
}
