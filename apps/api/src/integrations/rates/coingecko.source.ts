import type { RateEntry } from '@lazykoins/engine';
import {
  ChfPriceSourcePort,
  type KeyCheckResult,
  type SeriesRequest,
} from '../../rates/ports/rate-source.port';
import { redactSecrets } from '../ai/redact';
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
 * CoinGecko (the user's demo API key, F6.7): `/coins/{id}/market_chart/range` in CHF. For ranges
 * over 90 days CoinGecko answers one price per day at 00:00 UTC; the last price of each UTC day
 * is kept. The free plan allows ~30 calls a minute — calls are spaced 2.5 s apart.
 */
export class CoinGeckoSource extends ChfPriceSourcePort {
  readonly name = 'coingecko' as const;
  private readonly gate = new SerialGate(2500);

  constructor(private readonly fetcher: Fetcher = fetch) {
    super();
  }

  async dailyChf(
    request: SeriesRequest & {
      readonly coinId: string;
      readonly apiKey: string;
    },
  ): Promise<RateEntry[]> {
    const from = Math.floor(dayStartMs(request.from) / 1000);
    const to = Math.floor((dayStartMs(request.to) + DAY_MS - 1) / 1000);
    const url = `${BASE}/coins/${encodeURIComponent(request.coinId)}/market_chart/range?vs_currency=chf&from=${from}&to=${to}`;
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
        currency: 'CHF',
        date,
        value: price,
        source: this.name,
      });
    }
    return [...out.values()];
  }

  /**
   * `GET /ping` with the key — CoinGecko answers 401/403 for an unknown or wrong-plan key and 429
   * when the plan's limit is used up. The provider's message is kept, the key never.
   */
  async checkKey(apiKey: string): Promise<KeyCheckResult> {
    const url = `${BASE}/ping`;
    const started = Date.now();
    return this.gate.run(async () => {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            accept: 'application/json',
            'x-cg-demo-api-key': apiKey,
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        const timeout =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError');
        return {
          ok: false,
          code: timeout ? 'timeout' : 'network',
          status: null,
          providerMessage: null,
          url,
          millis: Date.now() - started,
        };
      }
      const millis = Date.now() - started;
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          providerMessage: null,
          url,
          millis,
        };
      }
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        code:
          response.status === 401 || response.status === 403
            ? 'invalidKey'
            : response.status === 429
              ? 'rateLimited'
              : 'providerError',
        status: response.status,
        providerMessage: providerMessageOf(text, apiKey),
        url,
        millis,
      };
    });
  }
}

/** CoinGecko's `{ status: { error_message } }` or `{ error }`, redacted; else the plain text. */
function providerMessageOf(text: string, apiKey: string): string | null {
  let message = text;
  try {
    const body = JSON.parse(text) as {
      status?: { error_message?: unknown };
      error?: unknown;
    };
    const fromStatus = body.status?.error_message;
    if (typeof fromStatus === 'string') message = fromStatus;
    else if (typeof body.error === 'string') message = body.error;
  } catch {
    // Not JSON (an HTML error page): the text itself.
  }
  const redacted = redactSecrets(message, [apiKey]);
  return redacted === '' ? null : redacted;
}
