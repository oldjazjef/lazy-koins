import type { RateEntry } from '@lazykoins/engine';
import {
  type SeriesRequest,
  UsdPriceSourcePort,
} from '../../rates/ports/rate-source.port';
import {
  dayStartMs,
  type Fetcher,
  getJson,
  SerialGate,
  utcDay,
} from './http-rate-client';

const BASE = 'https://data-api.binance.vision/api/v3/klines';
/** USD quotes, in order (FACHREGELN): `<SYM>USDT`, else `<SYM>BUSD`. */
const QUOTES = ['USDT', 'BUSD'] as const;
const DAY_MS = 86_400_000;
const LIMIT = 1000;

/**
 * Binance public market data (no key): daily klines (`1d`, UTC), the **close** of each day as the
 * USD price. Stablecoins count as 1 USD (FACHREGELN), so USDT/BUSD quotes are USD.
 */
export class BinanceKlinesSource extends UsdPriceSourcePort {
  readonly name = 'binance' as const;
  private readonly gate = new SerialGate(250);

  constructor(private readonly fetcher: Fetcher = fetch) {
    super();
  }

  async dailyUsd(request: SeriesRequest): Promise<RateEntry[]> {
    for (const quote of QUOTES) {
      const entries = await this.series(request, `${request.symbol}${quote}`);
      if (entries.length > 0) return entries;
    }
    return [];
  }

  private async series(
    request: SeriesRequest,
    pair: string,
  ): Promise<RateEntry[]> {
    const out = new Map<string, RateEntry>();
    const end = dayStartMs(request.to) + DAY_MS - 1;
    let start = dayStartMs(request.from);
    while (start <= end) {
      const url = `${BASE}?symbol=${encodeURIComponent(pair)}&interval=1d&startTime=${start}&endTime=${end}&limit=${LIMIT}`;
      const body = await getJson(this.fetcher, this.gate, this.name, url);
      if (!Array.isArray(body) || body.length === 0) break;
      let lastOpen = start;
      for (const kline of body) {
        if (!Array.isArray(kline)) continue;
        const openTime = Number(kline[0]);
        const close = kline[4];
        if (!Number.isFinite(openTime) || typeof close !== 'string') continue;
        lastOpen = Math.max(lastOpen, openTime);
        const date = utcDay(openTime);
        out.set(date, {
          kind: 'price',
          asset: request.asset,
          currency: 'USD',
          date,
          value: close,
          source: this.name,
        });
      }
      if (body.length < LIMIT) break;
      start = lastOpen + DAY_MS;
    }
    return [...out.values()];
  }
}
