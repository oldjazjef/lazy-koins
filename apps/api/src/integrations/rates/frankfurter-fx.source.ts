import type { RateEntry } from '@lazykoins/engine';
import { FxRateSourcePort } from '../../rates/ports/rate-source.port';
import { type Fetcher, getJson, SerialGate } from './http-rate-client';

const BASE = 'https://api.frankfurter.app';

/**
 * ECB reference rates through Frankfurter (no key): USD/CHF and EUR/CHF per working day. Missing
 * days (weekends, holidays) are not invented here — the engine forward-fills from the last fixing
 * (FACHREGELN, Devisen).
 */
export class FrankfurterFxSource extends FxRateSourcePort {
  readonly name = 'ecb' as const;
  private readonly gate = new SerialGate(200);

  constructor(private readonly fetcher: Fetcher = fetch) {
    super();
  }

  async dailyChf(
    base: 'USD' | 'EUR',
    from: string,
    to: string,
  ): Promise<RateEntry[]> {
    const url = `${BASE}/${from}..${to}?from=${base}&to=CHF`;
    const body = await getJson(this.fetcher, this.gate, this.name, url);
    const rates =
      typeof body === 'object' && body !== null && 'rates' in body
        ? (body as { rates: unknown }).rates
        : undefined;
    if (typeof rates !== 'object' || rates === null) return [];
    const out: RateEntry[] = [];
    for (const [date, perCurrency] of Object.entries(rates)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const value =
        typeof perCurrency === 'object' && perCurrency !== null
          ? (perCurrency as Record<string, unknown>)['CHF']
          : undefined;
      if (typeof value !== 'string') continue;
      out.push({
        kind: 'fx',
        asset: base,
        currency: 'CHF',
        date,
        value,
        source: this.name,
      });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
}
