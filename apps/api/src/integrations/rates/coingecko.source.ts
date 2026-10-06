import type { RateEntry } from '@lazykoins/engine';
import {
  FiatPriceSourcePort,
  type SeriesRequest,
} from '../../rates/ports/rate-source.port';
import {
  dayStartMs,
  type Fetcher,
  getJson,
  SerialGate,
  utcDay,
} from './http-rate-client';

const BASE = 'https://api.coingecko.com/api/v3';
const DAY_MS = 86_400_000;

/**
 * CoinGecko (the user's demo API key, F6.7): `/coins/{id}/market_chart/range` in the tax currency (CHF, EUR, …; F4.1a). For ranges
 * over 90 days CoinGecko answers one price per day at 00:00 UTC; the last price of each UTC day
 * is kept. The free plan allows ~30 calls a minute — calls are spaced 2.5 s apart.
 */
export class CoinGeckoSource extends FiatPriceSourcePort {
  readonly name = 'coingecko' as const;
  private readonly gate = new SerialGate(2500);

  constructor(private readonly fetcher: Fetcher = fetch) {
    super();
  }

  async dailyFiat(
    request: SeriesRequest & {
      readonly coinId: string;
      readonly apiKey: string;
      readonly currency: string;
    },
  ): Promise<RateEntry[]> {
    const from = Math.floor(dayStartMs(request.from) / 1000);
    const to = Math.floor((dayStartMs(request.to) + DAY_MS - 1) / 1000);
    const url = `${BASE}/coins/${encodeURIComponent(request.coinId)}/market_chart/range?vs_currency=${encodeURIComponent(request.currency.toLowerCase())}&from=${from}&to=${to}`;
    const body = await getJson(this.fetcher, this.gate, this.name, url, {
      'x-cg-demo-api-key': request.apiKey,
    });
    const prices =
      typeof body === 'object' && body !== null && 'prices' in body
        ? (body as { prices: unknown }).prices
        : undefined;
    if (!Array.isArray(prices)) return [];
    const out = new Map<string, RateEntry>();
    for (const point of prices) {
      if (!Array.isArray(point)) continue;
      const time = Number(point[0]);
      const price = point[1];
      if (!Number.isFinite(time) || typeof price !== 'string') continue;
      const date = utcDay(time);
      out.set(date, {
        kind: 'price',
        asset: request.asset,
        currency: request.currency,
        date,
        value: price,
        source: this.name,
      });
    }
    return [...out.values()];
  }
}
