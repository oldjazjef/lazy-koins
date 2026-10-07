import { CoinPaprikaSource } from './coinpaprika.source';
import {
  expectDecimalStrings,
  fakeFetch,
  json,
  opts,
} from './testing/fake-fetch';

describe('CoinPaprika', () => {
  it('reads the 00:00 UTC ticks in USD; end = the day after `to` (exclusive)', async () => {
    const { fetcher, calls } = fakeFetch({
      '/tickers/btc-bitcoin/historical': json(
        200,
        '[{"timestamp":"2026-10-01T00:00:00Z","price":84032.52,"volume_24h":26595647560,"market_cap":1688380744586},' +
          '{"timestamp":"2026-10-02T00:00:00Z","price":85440.123456789012345,"volume_24h":30814896447,"market_cap":1716704146755}]',
      ),
    });
    const series = await new CoinPaprikaSource(opts(fetcher)).daily({
      coin: 'btc-bitcoin',
      quote: 'USD',
      from: '2026-10-01',
      to: '2026-10-02',
    });
    expect(series).toEqual([
      { date: '2026-10-01', value: '84032.52' },
      { date: '2026-10-02', value: '85440.123456789012345' },
    ]);
    expectDecimalStrings(series);
    expect(calls[0]?.url).toContain(
      'start=2026-10-01&end=2026-10-03&interval=1d&quote=usd',
    );
  });

  it('leaves `end` out when it would be in the future', async () => {
    const { fetcher, calls } = fakeFetch({ historical: json(200, '[]') });
    expect(
      await new CoinPaprikaSource(opts(fetcher)).daily({
        coin: 'btc-bitcoin',
        quote: 'USD',
        from: '2026-10-06',
        to: '2026-10-07',
      }),
    ).toEqual([]);
    expect(calls[0]?.url).not.toContain('end=');
  });

  it.each([
    [
      'older than the free year (402)',
      json(
        402,
        '{"error":"Getting daily historical data before 2025-10-07 13:25:47.673661758 +0000 UTC is not allowed in this plan. Check plans on coinpaprika.com/api"}',
      ),
      'planLacksHistory',
    ],
    ['unknown id', json(404, '{"error":"id not found"}'), 'notFound'],
    [
      'rate limit',
      json(429, '{"error":"you have reached maximum request limit"}'),
      'rateLimited',
    ],
    [
      'bad parameters',
      json(400, '{"error":"invalid parameters"}'),
      'badResponse',
    ],
    ['malformed', json(200, '{"not":"a list"}'), 'badResponse'],
  ])('%s → %s', async (_name, answer, code) => {
    const { fetcher } = fakeFetch({ historical: answer });
    const error = await new CoinPaprikaSource(opts(fetcher))
      .daily({
        coin: 'btc-bitcoin',
        quote: 'USD',
        from: '2024-01-01',
        to: '2024-01-02',
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ source: 'coinpaprika', code });
  });

  it('keeps the provider words of a plan refusal', async () => {
    const { fetcher } = fakeFetch({
      historical: json(
        402,
        '{"error":"Getting daily historical data before 2025-10-07 is not allowed in this plan."}',
      ),
    });
    await expect(
      new CoinPaprikaSource(opts(fetcher)).daily({
        coin: 'btc-bitcoin',
        quote: 'USD',
        from: '2024-01-01',
        to: '2024-01-02',
      }),
    ).rejects.toMatchObject({
      detail: expect.stringContaining('not allowed in this plan'),
    });
  });

  it('USD only', async () => {
    await expect(
      new CoinPaprikaSource(opts(fakeFetch({}).fetcher)).daily({
        coin: 'btc-bitcoin',
        quote: 'EUR',
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'unsupportedQuote' });
  });

  it('searches currencies and resolves a symbol', async () => {
    const { fetcher, calls } = fakeFetch({
      '/search': json(
        200,
        '{"currencies":[{"id":"btc-bitcoin","name":"Bitcoin","symbol":"BTC","rank":1,"is_new":false,"is_active":true,"type":"coin"},' +
          '{"id":"wbtc-wrapped-bitcoin","name":"Wrapped Bitcoin","symbol":"WBTC","rank":20,"is_new":false,"is_active":true,"type":"token"}]}',
      ),
    });
    const source = new CoinPaprikaSource(opts(fetcher));
    expect(await source.resolveCoin({ symbol: 'btc' })).toEqual([
      { id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 },
    ]);
    expect(calls[0]?.url).toContain('c=currencies');
  });

  it('test: a tick 360 days back', async () => {
    const { fetcher, calls } = fakeFetch({
      historical: json(
        200,
        '[{"timestamp":"2025-10-12T00:00:00Z","price":62000}]',
      ),
    });
    expect(await new CoinPaprikaSource(opts(fetcher)).test()).toMatchObject({
      ok: true,
      historyDays: 365,
    });
    expect(calls[0]?.url).toContain('start=2025-10-12');
  });
});
