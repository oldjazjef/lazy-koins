import {
  checkRange,
  DAY_MS,
  dayStart,
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

const BASE = 'https://api-pub.bitfinex.com/v2';
const QUOTES = ['USD', 'EUR', 'GBP', 'JPY'] as const;
const LIMIT = 10_000;
/** Ticker → Bitfinex's currency code where they differ. */
const ALIASES: Record<string, string> = {
  USDT: 'UST',
  IOTA: 'IOT',
  DASH: 'DSH',
  QTUM: 'QTM',
};

/**
 * Bitfinex public candles (no key): `GET /v2/candles/trade:1D:t<BASE><QUOTE>/hist?sort=1` — the
 * **close** of each UTC day (candle `[MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]`, note CLOSE is the
 * third field), full history, ≤ 10 000 candles per call. Pairs with a code longer than three
 * letters are written `tBASE:QUOTE`. An unknown pair answers `[]` (an empty series); today's
 * unfinished candle is dropped. 30 requests a minute — spaced 2.1 s apart. No CHF pairs.
 */
export class BitfinexSource extends PriceHistorySourcePort {
  readonly id = 'bitfinex' as const;
  readonly capabilities: PriceSourceCapabilities = {
    label: 'Bitfinex',
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
    this.http = new PriceHttp(this.id, { spacingMs: 2100, ...options });
  }

  async daily(request: DailyPriceRequest): Promise<DailyPrice[]> {
    checkRange(request.from, request.to);
    const quote = request.quote.toUpperCase();
    if (!(QUOTES as readonly string[]).includes(quote)) {
      throw this.http.error(
        'unsupportedQuote',
        null,
        `no ${quote} pairs on Bitfinex`,
      );
    }
    const ticker = request.coin.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) {
      throw this.http.error('notFound', null, 'not a ticker');
    }
    const base = ALIASES[ticker] ?? ticker;
    const symbol = base.length > 3 ? `t${base}:${quote}` : `t${base}${quote}`;
    const series = new DaySeries(
      request.from,
      request.to,
      'last',
      this.http.today(),
    );
    const end = dayStart(request.to) + DAY_MS - 1;
    let start = dayStart(request.from);
    while (start <= end) {
      const answer = await this.call(
        `${BASE}/candles/trade:1D:${symbol}/hist?start=${start}&end=${end}&limit=${LIMIT}&sort=1`,
      );
      if (!Array.isArray(answer.body)) {
        throw this.http.fail(
          'badResponse',
          answer,
          [],
          'not a list of candles',
        );
      }
      let last = start;
      for (const candle of answer.body) {
        if (!Array.isArray(candle)) continue;
        const ms = Number(candle[0]);
        if (!Number.isFinite(ms)) continue;
        last = Math.max(last, ms);
        series.add(utcDay(ms), candle[2]);
      }
      if (answer.body.length < LIMIT) break;
      start = last + DAY_MS;
    }
    return series.toArray();
  }

  /** `GET /v2/platform/status` → `[1]` when operative. */
  test(): Promise<PriceSourceTestResult> {
    const url = `${BASE}/platform/status`;
    return this.http.test(url, async () => {
      const answer = await this.call(url);
      const operative = Array.isArray(answer.body) && answer.body[0] === '1';
      return {
        ...(operative ? {} : { ok: false, code: 'badResponse' as const }),
        status: answer.status,
        historyDays: null,
        plan: 'Public',
        detail: operative ? null : 'platform in maintenance',
      };
    });
  }

  private async call(url: string): Promise<PriceHttpAnswer> {
    const answer = await this.http.get(url);
    const body = answer.body;
    // Errors: `["error", <code>, "<message>"]` (10020 = bad parameters), rate limit 11010 / 429.
    if (Array.isArray(body) && body[0] === 'error') {
      const limited = String(body[1]) === '11010' || answer.status === 429;
      throw this.http.fail(limited ? 'rateLimited' : 'badResponse', answer);
    }
    if (answer.status === 429) throw this.http.fail('rateLimited', answer);
    if (answer.status < 200 || answer.status >= 300) {
      throw this.http.fail(
        answer.status === 404 ? 'notFound' : 'badResponse',
        answer,
      );
    }
    if (body === undefined)
      throw this.http.fail('badResponse', answer, [], 'not JSON');
    return answer;
  }
}
