import { CoinGeckoHistorySource } from './coingecko.source';
import {
  expectDecimalStrings,
  fakeFetch,
  json,
  ms,
  opts,
} from './testing/fake-fetch';

const KEY = 'CG-secret-demo-key-77';
const tooOld = json(
  401,
  '{"error":{"status":{"timestamp":"2026-10-07T13:32:10.955+00:00","error_code":10012,"error_message":"Your request exceeds the allowed time range. Public API users are limited to querying historical data within the past 365 days. Upgrade to a paid plan to enjoy full historical data access: https://www.coingecko.com/en/api/pricing. "}}}',
);

describe('CoinGecko (price-history port)', () => {
  it('keeps the first point of each UTC day, in any vs_currency, key in the header', async () => {
    const { fetcher, calls } = fakeFetch({
      '/coins/bitcoin/market_chart/range': json(
        200,
        `{"prices":[[${ms('2026-03-01')},70448.96922874598],[${ms('2026-03-01') + 3_600_000},70581.3],` +
          `[${ms('2026-03-02') + 120_000},71000.123456789012345]],"market_caps":[],"total_volumes":[]}`,
      ),
    });
    const series = await new CoinGeckoHistorySource(opts(fetcher)).daily({
      coin: 'bitcoin',
      quote: 'CHF',
      from: '2026-03-01',
      to: '2026-03-02',
      apiKey: KEY,
    });
    expect(series).toEqual([
      { date: '2026-03-01', value: '70448.96922874598' },
      { date: '2026-03-02', value: '71000.123456789012345' },
    ]);
    expectDecimalStrings(series);
    expect(calls[0]?.url).toContain('vs_currency=chf');
    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[0]?.headers['x-cg-demo-api-key']).toBe(KEY);
  });

  it('works without a key (no key header)', async () => {
    const { fetcher, calls } = fakeFetch({
      market_chart: json(200, '{"prices":[]}'),
    });
    expect(
      await new CoinGeckoHistorySource(opts(fetcher)).daily({
        coin: 'bitcoin',
        quote: 'USD',
        from: '2026-03-01',
        to: '2026-03-01',
      }),
    ).toEqual([]);
    expect(calls[0]?.headers['x-cg-demo-api-key']).toBeUndefined();
  });

  it.each([
    ['older than 365 days (10012)', tooOld, 'planLacksHistory'],
    [
      'wrong key (10002)',
      json(
        401,
        '{"status":{"error_code":10002,"error_message":"API Key Missing"}}',
      ),
      'invalidKey',
    ],
    ['unknown coin', json(404, '{"error":"coin not found"}'), 'notFound'],
    [
      'rate limit',
      json(
        429,
        '{"status":{"error_code":429,"error_message":"You\'ve exceeded the Rate Limit."}}',
      ),
      'rateLimited',
    ],
    ['malformed', json(200, 'not json'), 'badResponse'],
    ['no prices', json(200, '{"foo":1}'), 'badResponse'],
  ])('%s → %s', async (_name, answer, code) => {
    const { fetcher } = fakeFetch({ market_chart: answer });
    await expect(
      new CoinGeckoHistorySource(opts(fetcher)).daily({
        coin: 'bitcoin',
        quote: 'USD',
        from: '2020-09-13',
        to: '2020-09-15',
        apiKey: KEY,
      }),
    ).rejects.toMatchObject({ source: 'coingecko', code });
  });

  it('searches and resolves symbols and contracts', async () => {
    const { fetcher } = fakeFetch({
      '/search?query=eth': json(
        200,
        '{"coins":[{"id":"ethereum-wormhole","name":"Ethereum (Wormhole)","symbol":"ETH","market_cap_rank":2000},' +
          '{"id":"ethereum","name":"Ethereum","symbol":"ETH","market_cap_rank":2},' +
          '{"id":"ethena","name":"Ethena","symbol":"ENA","market_cap_rank":50}]}',
      ),
      '/coins/ethereum/contract/0xdac17f958d2ee523a2206206994597c13d831ec7':
        json(
          200,
          '{"id":"tether","symbol":"usdt","name":"Tether","market_cap_rank":3}',
        ),
    });
    const source = new CoinGeckoHistorySource(opts(fetcher));
    expect(
      (await source.resolveCoin({ symbol: 'eth' })).map((c) => c.id),
    ).toEqual(['ethereum', 'ethereum-wormhole']);
    expect(
      await source.resolveCoin({
        contract: {
          network: 'ethereum',
          address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        },
      }),
    ).toEqual([{ id: 'tether', symbol: 'USDT', name: 'Tether', rank: 3 }]);
  });

  it('test: ping with the key; a refused key is invalidKey without the key', async () => {
    const good = fakeFetch({
      '/ping': json(200, '{"gecko_says":"(V3) To the Moon!"}'),
    });
    expect(
      await new CoinGeckoHistorySource(opts(good.fetcher)).test(KEY),
    ).toMatchObject({
      ok: true,
      historyDays: 365,
      plan: 'Demo',
    });
    const bad = fakeFetch({
      '/ping': json(
        401,
        `{"status":{"error_code":10010,"error_message":"Invalid API Key ${KEY}"}}`,
      ),
    });
    const result = await new CoinGeckoHistorySource(opts(bad.fetcher)).test(
      KEY,
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'invalidKey',
      status: 401,
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
