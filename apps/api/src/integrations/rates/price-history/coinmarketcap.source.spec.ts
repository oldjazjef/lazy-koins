import { CoinMarketCapSource } from './coinmarketcap.source';
import { PriceSourceError } from './price-history-source.port';
import {
  expectDecimalStrings,
  fakeFetch,
  json,
  opts,
} from './testing/fake-fetch';

const KEY = 'cmc-secret-key-0042';

/** The documented shape of `/v3/cryptocurrency/quotes/historical` (data keyed by id). */
const history = (points: string) =>
  json(
    200,
    `{"data":{"1":{"id":1,"name":"Bitcoin","symbol":"BTC","is_active":1,"is_fiat":0,"quotes":[${points}]}},` +
      `"status":{"timestamp":"2026-03-05T22:43:48.471Z","error_code":0,"error_message":"","elapsed":10,"credit_count":1,"notice":""}}`,
  );
const quote = (time: string, price: string, currency = 'CHF') =>
  `{"timestamp":"${time}","quote":{"${currency}":{"price":${price},"volume_24h":4894120000,"market_cap":107057808682,"timestamp":"${time}"}}}`;
const cmcError = (status: number, code: number, message: string) =>
  json(
    status,
    `{"status":{"timestamp":"2026-10-07T12:00:00.000Z","error_code":${code},"error_message":"${message}","elapsed":0,"credit_count":0}}`,
  );

describe('CoinMarketCap', () => {
  it('reads daily quotes in the quote currency with the key in the header only', async () => {
    const { fetcher, calls } = fakeFetch({
      '/v3/cryptocurrency/quotes/historical': history(
        [
          quote('2025-12-30T00:00:00.000Z', '80123.123456789012345678'),
          quote('2025-12-30T00:05:00.000Z', '1'),
          quote('2025-12-31T00:00:00.000Z', '81000.5'),
        ].join(','),
      ),
    });
    const series = await new CoinMarketCapSource(opts(fetcher)).daily({
      coin: '1',
      quote: 'chf',
      from: '2025-12-30',
      to: '2025-12-31',
      apiKey: KEY,
    });
    expect(series).toEqual([
      { date: '2025-12-30', value: '80123.123456789012345678' },
      { date: '2025-12-31', value: '81000.5' },
    ]);
    expectDecimalStrings(series);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('id=1');
    expect(calls[0]?.url).toContain('interval=daily');
    expect(calls[0]?.url).toContain('convert=CHF');
    expect(calls[0]?.url).toContain('time_start=2025-12-30T00:00:00Z');
    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[0]?.headers['X-CMC_PRO_API_KEY']).toBe(KEY);
  });

  it('accepts data as an array too, and asks per year', async () => {
    const { fetcher, calls } = fakeFetch({
      '/v3/cryptocurrency/quotes/historical': json(
        200,
        `{"data":[{"id":1,"symbol":"BTC","quotes":[${quote('2024-06-01T00:00:00Z', '60000', 'USD')}]}],"status":{"error_code":0}}`,
      ),
    });
    const series = await new CoinMarketCapSource(opts(fetcher)).daily({
      coin: '1',
      quote: 'USD',
      from: '2024-01-01',
      to: '2025-06-30',
      apiKey: KEY,
    });
    expect(series).toEqual([{ date: '2024-06-01', value: '60000' }]);
    expect(calls).toHaveLength(2);
  });

  it('an id without quotes is an empty series; an unknown id is notFound', async () => {
    const empty = fakeFetch({
      historical: history(''),
    });
    expect(
      await new CoinMarketCapSource(opts(empty.fetcher)).daily({
        coin: '1',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-02',
        apiKey: KEY,
      }),
    ).toEqual([]);
    const unknown = fakeFetch({
      historical: json(200, '{"data":{},"status":{"error_code":0}}'),
    });
    await expect(
      new CoinMarketCapSource(opts(unknown.fetcher)).daily({
        coin: '999999',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-02',
        apiKey: KEY,
      }),
    ).rejects.toMatchObject({ code: 'notFound' });
  });

  it.each([
    [
      'plan without the endpoint',
      cmcError(
        403,
        1006,
        "Your API Key subscription plan doesn't support this endpoint.",
      ),
      'planLacksHistory',
    ],
    [
      'a range beyond the plan',
      cmcError(
        400,
        400,
        'Your plan is limited to 365 days of daily historical data.',
      ),
      'planLacksHistory',
    ],
    [
      'invalid key',
      cmcError(401, 1001, 'This API Key is invalid.'),
      'invalidKey',
    ],
    [
      'disabled key',
      cmcError(403, 1007, 'This API Key has been disabled.'),
      'invalidKey',
    ],
    [
      'minute limit',
      cmcError(
        429,
        1008,
        "You've exceeded your API Key's HTTP request rate limit.",
      ),
      'rateLimited',
    ],
    [
      'monthly credits',
      cmcError(429, 1010, "You've exceeded your API Key's monthly rate limit."),
      'rateLimited',
    ],
    ['server error', json(500, 'Internal Server Error'), 'badResponse'],
    ['malformed', json(200, '<html>maintenance</html>'), 'badResponse'],
  ])('%s → %s', async (_name, answer, code) => {
    const { fetcher } = fakeFetch({ historical: answer });
    await expect(
      new CoinMarketCapSource(opts(fetcher)).daily({
        coin: '1',
        quote: 'USD',
        from: '2020-01-01',
        to: '2020-01-02',
        apiKey: KEY,
      }),
    ).rejects.toMatchObject({ source: 'coinmarketcap', code });
  });

  it('never repeats the key, even when the provider echoes it', async () => {
    const { fetcher } = fakeFetch({
      historical: cmcError(401, 1001, `This API Key is invalid: ${KEY}`),
    });
    const error = await new CoinMarketCapSource(opts(fetcher))
      .daily({
        coin: '1',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-01',
        apiKey: KEY,
      })
      .then(
        () => {
          throw new Error('expected a failure');
        },
        (e: unknown) => e as PriceSourceError,
      );
    expect(error).toBeInstanceOf(PriceSourceError);
    expect(error.detail).toContain('This API Key is invalid');
    expect(
      `${error.message} ${error.detail} ${JSON.stringify(error)}`,
    ).not.toContain(KEY);
  });

  it('without a key: invalidKey and no request', async () => {
    const { fetcher, calls } = fakeFetch({});
    await expect(
      new CoinMarketCapSource(opts(fetcher)).daily({
        coin: '1',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'invalidKey' });
    expect(calls).toEqual([]);
  });

  it('resolves a symbol through the id map, exact symbol and rank first', async () => {
    const { fetcher, calls } = fakeFetch({
      '/v1/cryptocurrency/map': json(
        200,
        '{"data":[{"id":99999,"rank":null,"name":"Fake Bitcoin","symbol":"BTC","slug":"fake","is_active":1},' +
          '{"id":1,"rank":1,"name":"Bitcoin","symbol":"BTC","slug":"bitcoin","is_active":1}],"status":{"error_code":0}}',
      ),
    });
    const found = await new CoinMarketCapSource(opts(fetcher)).resolveCoin(
      { symbol: 'btc' },
      KEY,
    );
    expect(found).toEqual([
      { id: '1', symbol: 'BTC', name: 'Bitcoin', rank: 1 },
      { id: '99999', symbol: 'BTC', name: 'Fake Bitcoin', rank: null },
    ]);
    expect(calls[0]?.url).toContain('symbol=BTC');
  });

  it('resolves a contract through /v2/cryptocurrency/info; an unknown one is empty', async () => {
    const address = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const { fetcher } = fakeFetch({
      [`address=${address}`]: json(
        200,
        '{"data":{"825":{"id":825,"name":"Tether USDt","symbol":"USDT","slug":"tether"}},"status":{"error_code":0}}',
      ),
      'address=0x0000': cmcError(400, 400, 'Invalid value for "address"'),
    });
    const source = new CoinMarketCapSource(opts(fetcher));
    expect(
      await source.resolveCoin(
        { contract: { network: 'ethereum', address } },
        KEY,
      ),
    ).toEqual([{ id: '825', symbol: 'USDT', name: 'Tether USDt', rank: null }]);
    expect(
      await source.resolveCoin(
        {
          contract: {
            network: 'ethereum',
            address: '0x0000000000000000000000000000000000000001',
          },
        },
        KEY,
      ),
    ).toEqual([]);
  });

  it('test: key info + depth probes → Basic (365 days)', async () => {
    const { fetcher, calls } = fakeFetch({
      '/v1/key/info': json(
        200,
        '{"data":{"plan":{"credit_limit_monthly":15000,"credit_limit_monthly_reset":"In 7 days","rate_limit_minute":50},"usage":{"current_month":{"credits_used":12,"credits_left":14988}}},"status":{"error_code":0}}',
      ),
      historical: [
        history(quote('2025-10-12T00:00:00Z', '62000', 'USD')),
        cmcError(
          403,
          1006,
          "Your API Key subscription plan doesn't support this endpoint.",
        ),
      ],
    });
    const result = await new CoinMarketCapSource(opts(fetcher)).test(KEY);
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      historyDays: 365,
      plan: '15000 credits/month, 50/min',
      url: 'https://pro-api.coinmarketcap.com/v1/key/info',
    });
    expect(calls.map((c) => c.url)).toEqual([
      'https://pro-api.coinmarketcap.com/v1/key/info',
      expect.stringContaining('time_start=2025-10-12T00:00:00Z'),
      expect.stringContaining('time_start=2023-10-13T00:00:00Z'),
    ]);
  });

  it('test: a key whose plan has no history is not ok (planLacksHistory)', async () => {
    const { fetcher } = fakeFetch({
      '/v1/key/info': json(
        200,
        '{"data":{"plan":{}},"status":{"error_code":0}}',
      ),
      historical: cmcError(
        403,
        1006,
        "Your API Key subscription plan doesn't support this endpoint.",
      ),
    });
    expect(
      await new CoinMarketCapSource(opts(fetcher)).test(KEY),
    ).toMatchObject({
      ok: false,
      code: 'planLacksHistory',
      historyDays: null,
    });
  });

  it('test: a refused key is invalidKey and the result never holds it', async () => {
    const { fetcher } = fakeFetch({
      '/v1/key/info': cmcError(401, 1001, `This API Key is invalid. ${KEY}`),
    });
    const result = await new CoinMarketCapSource(opts(fetcher)).test(KEY);
    expect(result).toMatchObject({
      ok: false,
      code: 'invalidKey',
      status: 401,
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
