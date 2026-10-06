import { BinanceKlinesSource } from './binance-klines.source';
import { CoinGeckoSource } from './coingecko.source';
import { FrankfurterFxSource } from './frankfurter-fx.source';
import {
  type Fetcher,
  parseJsonKeepingNumbers,
  RateSourceError,
} from './http-rate-client';

/** A fetch double: answers by URL prefix, records every call — no network. */
function fakeFetch(answers: Record<string, { status: number; body: string }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const match = Object.entries(answers).find(([prefix]) =>
      url.includes(prefix),
    );
    const answer = match?.[1] ?? { status: 404, body: '{}' };
    return new Response(answer.body, { status: answer.status });
  };
  return { fetcher, calls };
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`);

describe('JSON numbers keep their source text', () => {
  it('turns every number into the string it was written as', () => {
    expect(
      parseJsonKeepingNumbers(
        '{"a": 0.91234567890123456789, "b": [1e-7, 12], "c": "x"}',
      ),
    ).toEqual({ a: '0.91234567890123456789', b: ['1e-7', '12'], c: 'x' });
  });
});

describe('Binance daily klines', () => {
  it('takes the close of each UTC day, <SYM>USDT first, then <SYM>BUSD', async () => {
    const { fetcher, calls } = fakeFetch({
      'symbol=XYZUSDT': { status: 400, body: '{"code":-1121}' },
      'symbol=XYZBUSD': {
        status: 200,
        body: JSON.stringify([
          [day('2025-12-30'), '1', '2', '0.5', '1.10000000', '9', 0],
          [day('2025-12-31'), '1', '2', '0.5', '1.23456789', '9', 0],
        ]),
      },
    });
    const source = new BinanceKlinesSource(fetcher);
    const entries = await source.dailyUsd({
      asset: 'XYZ',
      symbol: 'XYZ',
      from: '2025-12-30',
      to: '2025-12-31',
    });
    expect(entries).toEqual([
      {
        kind: 'price',
        asset: 'XYZ',
        currency: 'USD',
        date: '2025-12-30',
        value: '1.10000000',
        source: 'binance',
      },
      {
        kind: 'price',
        asset: 'XYZ',
        currency: 'USD',
        date: '2025-12-31',
        value: '1.23456789',
        source: 'binance',
      },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      expect.stringContaining(
        'https://data-api.binance.vision/api/v3/klines?symbol=XYZUSDT&interval=1d',
      ),
      expect.stringContaining('symbol=XYZBUSD'),
    ]);
  });

  it('reports a server error instead of an empty series', async () => {
    const { fetcher } = fakeFetch({
      klines: { status: 503, body: 'busy' },
    });
    await expect(
      new BinanceKlinesSource(fetcher).dailyUsd({
        asset: 'BTC',
        symbol: 'BTC',
        from: '2025-01-01',
        to: '2025-01-02',
      }),
    ).rejects.toBeInstanceOf(RateSourceError);
  });
});

describe('CoinGecko market chart', () => {
  it('asks in CHF with the demo key and keeps the last price of each UTC day', async () => {
    const { fetcher, calls } = fakeFetch({
      '/coins/bitcoin/market_chart/range': {
        status: 200,
        body: `{"prices":[[${day('2025-12-31')},85000.12],[${day('2025-12-31') + 3600000},85100.5],[${day('2026-01-01')},86000]]}`,
      },
    });
    const entries = await new CoinGeckoSource(fetcher).dailyFiat({
      asset: 'BTC',
      symbol: 'BTC',
      from: '2025-12-31',
      to: '2026-01-01',
      coinId: 'bitcoin',
      apiKey: 'demo-key',
      currency: 'CHF',
    });
    expect(entries.map((e) => [e.date, e.value, e.currency])).toEqual([
      ['2025-12-31', '85100.5', 'CHF'],
      ['2026-01-01', '86000', 'CHF'],
    ]);
    expect(calls[0]?.url).toContain('vs_currency=chf');
    expect(calls[0]?.headers['x-cg-demo-api-key']).toBe('demo-key');
  });

  it('asks in the tax currency of the project (F4.1a)', async () => {
    const { fetcher, calls } = fakeFetch({
      '/coins/bitcoin/market_chart/range': {
        status: 200,
        body: `{"prices":[[${day('2025-12-31')},80000.5]]}`,
      },
    });
    const entries = await new CoinGeckoSource(fetcher).dailyFiat({
      asset: 'BTC',
      symbol: 'BTC',
      from: '2025-12-31',
      to: '2025-12-31',
      coinId: 'bitcoin',
      apiKey: 'demo-key',
      currency: 'EUR',
    });
    expect(entries.map((e) => [e.value, e.currency])).toEqual([
      ['80000.5', 'EUR'],
    ]);
    expect(calls[0]?.url).toContain('vs_currency=eur');
  });
});

describe('Frankfurter (ECB)', () => {
  it('reads USD/CHF per working day with the exact digits', async () => {
    const { fetcher, calls } = fakeFetch({
      'api.frankfurter.app/2025-12-29..2026-01-02?from=USD&to=CHF': {
        status: 200,
        body: '{"amount":1.0,"base":"USD","start_date":"2025-12-29","end_date":"2026-01-02","rates":{"2025-12-29":{"CHF":0.79123},"2025-12-30":{"CHF":0.7905}}}',
      },
    });
    const entries = await new FrankfurterFxSource(fetcher).daily(
      'USD',
      'CHF',
      '2025-12-29',
      '2026-01-02',
    );
    expect(entries).toEqual([
      {
        kind: 'fx',
        asset: 'USD',
        currency: 'CHF',
        date: '2025-12-29',
        value: '0.79123',
        source: 'ecb',
      },
      {
        kind: 'fx',
        asset: 'USD',
        currency: 'CHF',
        date: '2025-12-30',
        value: '0.7905',
        source: 'ecb',
      },
    ]);
    expect(calls).toHaveLength(1);
  });

  it('reads any pair the tax currency needs (F4.1a): USD/EUR', async () => {
    const { fetcher, calls } = fakeFetch({
      'api.frankfurter.app/2025-12-29..2026-01-02?from=USD&to=EUR': {
        status: 200,
        body: '{"amount":1.0,"base":"USD","rates":{"2025-12-30":{"EUR":0.85123}}}',
      },
    });
    const source = new FrankfurterFxSource(fetcher);
    expect(
      await source.daily('USD', 'EUR', '2025-12-29', '2026-01-02'),
    ).toEqual([
      {
        kind: 'fx',
        asset: 'USD',
        currency: 'EUR',
        date: '2025-12-30',
        value: '0.85123',
        source: 'ecb',
      },
    ]);
    // A currency in itself is 1 — nothing to ask.
    expect(
      await source.daily('EUR', 'EUR', '2025-12-29', '2026-01-02'),
    ).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
