import { DefiLlamaSource } from './defillama.source';
import {
  expectDecimalStrings,
  fakeFetch,
  json,
  opts,
  sec,
} from './testing/fake-fetch';

describe('DefiLlama', () => {
  it('files end-of-day points under their day and drops today', async () => {
    // As recorded: start = the midnight after `from`, the first point one second before it.
    const { fetcher, calls } = fakeFetch({
      '/chart/coingecko%3Abitcoin': json(
        200,
        `{"coins":{"coingecko:bitcoin":{"symbol":"BTC","confidence":0.99,"prices":[` +
          `{"timestamp":${sec('2026-10-05') - 1},"price":93450},` +
          `{"timestamp":${sec('2026-10-06') - 3},"price":94423.123456789012345},` +
          `{"timestamp":${sec('2026-10-07') - 2},"price":96895},` +
          `{"timestamp":${sec('2026-10-07') + 40_000},"price":97000}]}}}`,
      ),
    });
    const series = await new DefiLlamaSource(opts(fetcher)).daily({
      coin: 'coingecko:bitcoin',
      quote: 'USD',
      from: '2026-10-04',
      to: '2026-10-07',
    });
    expect(series).toEqual([
      { date: '2026-10-04', value: '93450' },
      { date: '2026-10-05', value: '94423.123456789012345' },
      { date: '2026-10-06', value: '96895' },
    ]);
    expectDecimalStrings(series);
    expect(calls[0]?.url).toContain(`start=${sec('2026-10-05')}`);
    expect(calls[0]?.url).toContain('span=4');
    expect(calls[0]?.url).toContain('period=1d');
  });

  it('a bare CoinGecko id becomes coingecko:<id>; a contract key is passed as is', async () => {
    const { fetcher, calls } = fakeFetch({
      '/chart/': json(200, '{"coins":{}}'),
    });
    const source = new DefiLlamaSource(opts(fetcher));
    expect(
      await source.daily({
        coin: 'ethereum',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).toEqual([]);
    await source.daily({
      coin: 'ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7',
      quote: 'USD',
      from: '2026-01-01',
      to: '2026-01-01',
    });
    expect(calls[0]?.url).toContain('/chart/coingecko%3Aethereum?');
    expect(calls[1]?.url).toContain(
      '/chart/ethereum%3A0xdac17f958d2ee523a2206206994597c13d831ec7?',
    );
  });

  it('USD only: another quote is unsupportedQuote without a request', async () => {
    const { fetcher, calls } = fakeFetch({});
    await expect(
      new DefiLlamaSource(opts(fetcher)).daily({
        coin: 'coingecko:bitcoin',
        quote: 'CHF',
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'unsupportedQuote' });
    expect(calls).toEqual([]);
  });

  it.each([
    ['rate limit', json(429, 'Too Many Requests'), 'rateLimited'],
    ['server error', json(502, '<html>Bad gateway</html>'), 'badResponse'],
    ['malformed', json(200, 'nope'), 'badResponse'],
    [
      'prices not a list',
      json(200, '{"coins":{"coingecko:bitcoin":{"prices":7}}}'),
      'badResponse',
    ],
  ])('%s → %s', async (_name, answer, code) => {
    const { fetcher } = fakeFetch({ '/chart/': answer });
    await expect(
      new DefiLlamaSource(opts(fetcher)).daily({
        coin: 'coingecko:bitcoin',
        quote: 'USD',
        from: '2026-01-01',
        to: '2026-01-02',
      }),
    ).rejects.toMatchObject({ source: 'defillama', code });
  });

  it('resolves a contract to its DefiLlama key', async () => {
    const { fetcher } = fakeFetch({
      '/prices/current/': json(
        200,
        '{"coins":{"ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7":{"decimals":6,"symbol":"USDT","price":1.0002,"timestamp":1790000000,"confidence":0.99}}}',
      ),
    });
    expect(
      await new DefiLlamaSource(opts(fetcher)).resolveCoin({
        contract: {
          network: 'ethereum',
          address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        },
      }),
    ).toEqual([
      {
        id: 'ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7',
        symbol: 'USDT',
        name: null,
        rank: null,
      },
    ]);
  });

  it('test: Bitcoin answers', async () => {
    const { fetcher } = fakeFetch({
      '/prices/current/': json(
        200,
        '{"coins":{"coingecko:bitcoin":{"symbol":"BTC","price":97000}}}',
      ),
    });
    expect(await new DefiLlamaSource(opts(fetcher)).test()).toMatchObject({
      ok: true,
      historyDays: null,
    });
  });
});
