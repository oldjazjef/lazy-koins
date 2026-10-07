import {
  addDays,
  asRecord,
  checkRange,
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
  type PriceSourceErrorCode,
  type PriceSourceTestResult,
} from './price-history-source.port';

const BASE = 'https://api.kraken.com/0/public';
/** Kraken returns at most the 720 most recent candles of an interval — older ones are gone. */
const DEPTH_DAYS = 720;
const QUOTES = ['USD', 'EUR', 'CHF', 'GBP', 'CAD', 'JPY', 'AUD'] as const;
/** Ticker → Kraken's asset name where they differ. */
const ALIASES: Record<string, string> = { BTC: 'XBT', DOGE: 'XDG' };

/**
 * Kraken public OHLC (no key): `GET /0/public/OHLC?pair=<BASE><QUOTE>&interval=1440` — the
 * **close** of each UTC day, with CHF/EUR/USD pairs. Kraken serves only the **last 720 daily
 * candles** whatever `since` says, so a range ending before that is `planLacksHistory` (the
 * provider's fixed depth) and an older start is cut. The newest candle is today's unfinished one
 * and is dropped. Errors come in `error: ["EQuery:Unknown asset pair"]` with HTTP 200. Public
 * calls are spaced 1 s apart.
 */
export class KrakenSource extends PriceHistorySourcePort {
  readonly id = 'kraken' as const;
  readonly capabilities: PriceSourceCapabilities = {
    label: 'Kraken',
    key: 'none',
    quotes: QUOTES,
    freeHistoryDays: DEPTH_DAYS,
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
    this.http = new PriceHttp(this.id, { spacingMs: 1000, ...options });
  }

  async daily(request: DailyPriceRequest): Promise<DailyPrice[]> {
    checkRange(request.from, request.to);
    const quote = request.quote.toUpperCase();
    if (!(QUOTES as readonly string[]).includes(quote)) {
      throw this.http.error(
        'unsupportedQuote',
        null,
        `no ${quote} pairs on Kraken`,
      );
    }
    const ticker = request.coin.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) {
      throw this.http.error('notFound', null, 'not a ticker');
    }
    const today = this.http.today();
    const oldest = addDays(today, -(DEPTH_DAYS - 1));
    if (request.to < oldest) {
      throw this.http.error(
        'planLacksHistory',
        null,
        `Kraken keeps only the last ${DEPTH_DAYS} daily candles (from ${oldest})`,
      );
    }
    const pair = `${ALIASES[ticker] ?? ticker}${quote}`;
    const since = dayStart(request.from) / 1000 - 1;
    const answer = await this.call(
      `${BASE}/OHLC?pair=${pair}&interval=1440&since=${since}`,
    );
    const result = asRecord(asRecord(answer.body)?.['result']);
    const rows = Object.entries(result ?? {}).find(
      ([key, value]) => key !== 'last' && Array.isArray(value),
    )?.[1];
    if (!Array.isArray(rows)) {
      throw this.http.fail('badResponse', answer, [], 'no candles');
    }
    const series = new DaySeries(request.from, request.to, 'last', today);
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const seconds = Number(row[0]);
      if (!Number.isFinite(seconds)) continue;
      series.add(utcDay(seconds * 1000), row[4]);
    }
    return series.toArray();
  }

  /** `GET /0/public/Time` — the API answers. */
  test(): Promise<PriceSourceTestResult> {
    const url = `${BASE}/Time`;
    return this.http.test(url, async () => {
      const answer = await this.call(url);
      return {
        status: answer.status,
        historyDays: DEPTH_DAYS,
        plan: 'Public',
        detail: null,
      };
    });
  }

  private async call(url: string): Promise<PriceHttpAnswer> {
    const answer = await this.http.get(url);
    const raw = asRecord(answer.body)?.['error'];
    const errors = Array.isArray(raw)
      ? raw.filter((e): e is string => typeof e === 'string')
      : [];
    const first = errors[0];
    if (first !== undefined) {
      throw this.http.fail(
        codeOfKrakenError(first),
        answer,
        [],
        errors.join(', '),
      );
    }
    if (answer.status === 429) throw this.http.fail('rateLimited', answer);
    if (answer.status < 200 || answer.status >= 300) {
      throw this.http.fail(
        answer.status === 404 ? 'notFound' : 'badResponse',
        answer,
      );
    }
    if (answer.body === undefined) {
      throw this.http.fail('badResponse', answer, [], 'not JSON');
    }
    return answer;
  }
}

function codeOfKrakenError(error: string): PriceSourceErrorCode {
  if (/Unknown asset pair|Unknown asset/i.test(error)) return 'notFound';
  if (/Rate limit|Too many requests|Throttled/i.test(error))
    return 'rateLimited';
  return 'badResponse';
}
