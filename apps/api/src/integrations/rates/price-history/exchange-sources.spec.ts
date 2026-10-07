import { BitfinexSource } from './bitfinex.source';
import { CoinbaseSource } from './coinbase.source';
import { KrakenSource } from './kraken.source';
import {
  expectDecimalStrings,
  fakeFetch,
  json,
  ms,
  opts,
  sec,
} from './testing/fake-fetch';

describe('Kraken OHLC', () => {
  it('takes the close of each day (XBT for BTC, CHF pair) and drops today', async () => {
    const { fetcher, calls } = fakeFetch({
      '/OHLC?pair=XBTCHF': json(
        200,
        `{"error":[],"result":{"XBTCHF":[` +
          `[${sec('2026-10-05')},"58614.4","58693.1","57620.2","58303.6","58100.0","12.42848127",1022],` +
          `[${sec('2026-10-06')},"58383.8","59695.4","58206.1","59199.40000000001","58875.4","45.07670902",2233],` +
          `[${sec('2026-10-07')},"59137.0","59290.6","58800.0","59022.3","58971.9","3.17631726",497]` +
          `],"last":${sec('2026-10-06')}}}`,
      ),
    });
    const series = await new KrakenSource(opts(fetcher)).daily({
      coin: 'BTC',
      quote: 'CHF',
      from: '2026-10-05',
      to: '2026-10-07',
    });
    expect(series).toEqual([
      { date: '2026-10-05', value: '58303.6' },
      { date: '2026-10-06', value: '59199.40000000001' },
    ]);
    expectDecimalStrings(series);
    expect(calls[0]?.url).toContain(
      `interval=1440&since=${sec('2026-10-05') - 1}`,
    );
  });

  it('a range older than the 720 kept candles is planLacksHistory without a request', async () => {
    const { fetcher, calls } = fakeFetch({});
    await expect(
      new KrakenSource(opts(fetcher)).daily({
        coin: 'BTC',
        quote: 'USD',
        from: '2023-01-01',
        to: '2023-12-31',
      }),
    ).rejects.toMatchObject({ code: 'planLacksHistory' });
    expect(calls).toEqual([]);
  });

  it.each([
    [
      'unknown pair',
      json(200, '{"error":["EQuery:Unknown asset pair"]}'),
      'notFound',
    ],
    [
      'rate limit',
      json(200, '{"error":["EGeneral:Too many requests"]}'),
      'rateLimited',
    ],
    ['HTTP 429', json(429, ''), 'rateLimited'],
    [
      'unavailable',
      json(200, '{"error":["EService:Unavailable"]}'),
      'badResponse',
    ],
    ['malformed', json(200, '{"error":[],"result":{"last":1}}'), 'badResponse'],
  ])('%s → %s', async (_name, answer, code) => {
    const { fetcher } = fakeFetch({ '/OHLC': answer });
    await expect(
      new KrakenSource(opts(fetcher)).daily({
        coin: 'ABC',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-02',
      }),
    ).rejects.toMatchObject({ source: 'kraken', code });
  });

  it('a quote without pairs is unsupportedQuote', async () => {
    await expect(
      new KrakenSource(opts(fakeFetch({}).fetcher)).daily({
        coin: 'BTC',
        quote: 'SEK',
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'unsupportedQuote' });
  });
});

describe('Bitfinex candles', () => {
  it('reads CLOSE (the third field), numbers as source text, and drops today', async () => {
    const { fetcher, calls } = fakeFetch({
      'trade:1D:tBTCEUR/hist': json(
        200,
        `[[${ms('2026-10-05')},90412,91271.123456789012345,91846,89681,13.71322277],` +
          `[${ms('2026-10-06')},91271,92000,92500,91000,10.5],` +
          `[${ms('2026-10-07')},92000,93000,93500,91900,1.2]]`,
      ),
    });
    const series = await new BitfinexSource(opts(fetcher)).daily({
      coin: 'BTC',
      quote: 'EUR',
      from: '2026-10-05',
      to: '2026-10-07',
    });
    expect(series).toEqual([
      { date: '2026-10-05', value: '91271.123456789012345' },
      { date: '2026-10-06', value: '92000' },
    ]);
    expectDecimalStrings(series);
    expect(calls[0]?.url).toContain('sort=1');
    expect(calls[0]?.url).toContain(`start=${ms('2026-10-05')}`);
  });

  it('writes long codes as tBASE:QUOTE and maps USDT to UST', async () => {
    const { fetcher, calls } = fakeFetch({ '/candles/': json(200, '[]') });
    const source = new BitfinexSource(opts(fetcher));
    await source.daily({
      coin: 'DOGE',
      quote: 'USD',
      from: '2026-01-01',
      to: '2026-01-01',
    });
    await source.daily({
      coin: 'USDT',
      quote: 'USD',
      from: '2026-01-01',
      to: '2026-01-01',
    });
    expect(calls[0]?.url).toContain('trade:1D:tDOGE:USD/hist');
    expect(calls[1]?.url).toContain('trade:1D:tUSTUSD/hist');
  });

  it.each([
    [
      'rate limit',
      json(429, '["error",11010,"ratelimit: error"]'),
      'rateLimited',
    ],
    [
      'parameter error',
      json(500, '["error",10020,"time_interval: invalid"]'),
      'badResponse',
    ],
    ['malformed', json(200, '{"a":1}'), 'badResponse'],
  ])('%s → %s', async (_name, answer, code) => {
    const { fetcher } = fakeFetch({ '/candles/': answer });
    await expect(
      new BitfinexSource(opts(fetcher)).daily({
        coin: 'BTC',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-02',
      }),
    ).rejects.toMatchObject({ source: 'bitfinex', code });
  });

  it('has no CHF pairs', async () => {
    await expect(
      new BitfinexSource(opts(fakeFetch({}).fetcher)).daily({
        coin: 'BTC',
        quote: 'CHF',
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'unsupportedQuote' });
  });
});

describe('Coinbase Exchange candles', () => {
  it('reads the close (fifth field), newest-first answers sorted, user agent set', async () => {
    const { fetcher, calls } = fakeFetch({
      '/products/BTC-EUR/candles': json(
        200,
        `[[${sec('2025-01-02')},91000,95306.46,91173.5,94383.32,398.80103233],` +
          `[${sec('2025-01-01')},89665,91749,90119.83,91175.14000000000001,233.83137205]]`,
      ),
    });
    const series = await new CoinbaseSource(opts(fetcher)).daily({
      coin: 'btc',
      quote: 'EUR',
      from: '2025-01-01',
      to: '2025-01-02',
    });
    expect(series).toEqual([
      { date: '2025-01-01', value: '91175.14000000000001' },
      { date: '2025-01-02', value: '94383.32' },
    ]);
    expectDecimalStrings(series);
    expect(calls[0]?.url).toContain(
      'granularity=86400&start=2025-01-01T00:00:00Z&end=2025-01-02T00:00:00Z',
    );
    expect(calls[0]?.headers['user-agent']).toBe('lazy-koins');
  });

  it('asks in chunks of 300 days', async () => {
    const { fetcher, calls } = fakeFetch({ '/candles': json(200, '[]') });
    await new CoinbaseSource(opts(fetcher)).daily({
      coin: 'BTC',
      quote: 'USD',
      from: '2024-01-01',
      to: '2024-12-31',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain('end=2024-10-26T00:00:00Z');
    expect(calls[1]?.url).toContain('start=2024-10-27T00:00:00Z');
  });

  it.each([
    ['unknown product', json(404, '{"message":"NotFound"}'), 'notFound'],
    [
      'rate limit',
      json(429, '{"message":"Public rate limit exceeded"}'),
      'rateLimited',
    ],
    [
      'bad request',
      json(
        400,
        '{"message":"granularity too small for the requested time range"}',
      ),
      'badResponse',
    ],
    ['malformed', json(200, '<html></html>'), 'badResponse'],
  ])('%s → %s', async (_name, answer, code) => {
    const { fetcher } = fakeFetch({ '/candles': answer });
    await expect(
      new CoinbaseSource(opts(fetcher)).daily({
        coin: 'BTC',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-02',
      }),
    ).rejects.toMatchObject({ source: 'coinbase', code });
  });

  it('test: /time answers', async () => {
    const { fetcher } = fakeFetch({
      '/time': json(
        200,
        '{"iso":"2026-10-07T12:00:00.000Z","epoch":1791374400.0}',
      ),
    });
    expect(await new CoinbaseSource(opts(fetcher)).test()).toMatchObject({
      ok: true,
      url: 'https://api.exchange.coinbase.com/time',
    });
  });
});
