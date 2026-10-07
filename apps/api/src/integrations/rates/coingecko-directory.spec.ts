import { CoinGeckoDirectory } from './coingecko-directory';
import { type Fetcher, RateSourceError, SerialGate } from './http-rate-client';

/** A fetch double: answers by URL part, records every call — no network. */
function fakeFetch(answers: Record<string, { status: number; body: string }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const match = Object.entries(answers).find(([part]) => url.includes(part));
    const answer = match?.[1] ?? { status: 404, body: '{}' };
    return new Response(answer.body, { status: answer.status });
  };
  return { fetcher, calls };
}

/** The shape of CoinGecko's `/search` answer (as observed 07.10.2026), shortened. */
const SEARCH = JSON.stringify({
  coins: [
    {
      id: 'popnut',
      name: 'POPNUT',
      api_symbol: 'popnut',
      symbol: 'POPNUT',
      market_cap_rank: null,
    },
    {
      id: 'open-ticketing-ecosystem',
      name: 'OPEN Ticketing Ecosystem',
      api_symbol: 'open-ticketing-ecosystem',
      symbol: 'OPN',
      market_cap_rank: 3301,
    },
    {
      id: 'opinion',
      name: 'Opinion',
      api_symbol: 'opinion',
      symbol: 'OPN',
      market_cap_rank: 1191,
    },
  ],
  exchanges: [],
});

const directory = (fetcher: Fetcher) =>
  new CoinGeckoDirectory(new SerialGate(0), fetcher);

describe('CoinGecko coin directory ("Coin wählen", F7.4)', () => {
  it('searches: exact symbol first, then by rank; sends the key only when given', async () => {
    const { fetcher, calls } = fakeFetch({
      '/search?query=OPN': { status: 200, body: SEARCH },
    });
    const found = await directory(fetcher).search('coingecko', 'OPN', {
      limit: 10,
    });
    expect(found.map((c) => [c.id, c.symbol, c.marketCapRank])).toEqual([
      ['opinion', 'OPN', 1191],
      ['open-ticketing-ecosystem', 'OPN', 3301],
      ['popnut', 'POPNUT', null],
    ]);
    expect(calls[0]?.headers).not.toHaveProperty('x-cg-demo-api-key');
    await directory(fetcher).search('coingecko', 'OPN', {
      apiKey: 'CG-key',
      limit: 1,
    });
    expect(calls[1]?.headers['x-cg-demo-api-key']).toBe('CG-key');
  });

  it('looks a coin up by id; an unknown id is undefined, a failure throws', async () => {
    const { fetcher } = fakeFetch({
      '/coins/open-ticketing-ecosystem?': {
        status: 200,
        body: JSON.stringify({
          id: 'open-ticketing-ecosystem',
          symbol: 'opn',
          name: 'OPEN Ticketing Ecosystem',
          market_cap_rank: 3301,
        }),
      },
      '/coins/busy?': { status: 429, body: '{}' },
    });
    expect(
      await directory(fetcher).find(
        'coingecko',
        'open-ticketing-ecosystem',
        {},
      ),
    ).toEqual({
      provider: 'coingecko',
      id: 'open-ticketing-ecosystem',
      name: 'OPEN Ticketing Ecosystem',
      symbol: 'OPN',
      marketCapRank: 3301,
    });
    expect(
      await directory(fetcher).find('coingecko', 'no-such-coin', {}),
    ).toBeUndefined();
    await expect(
      directory(fetcher).find('coingecko', 'busy', {}),
    ).rejects.toBeInstanceOf(RateSourceError);
  });

  it('pages the market list and retries once after a 429 (public API pacing)', async () => {
    let calls = 0;
    const fetcher: Fetcher = async (url) => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 429 });
      expect(url).toContain('/coins/markets?vs_currency=usd');
      return new Response(
        JSON.stringify([
          {
            id: 'polkadot',
            symbol: 'dot',
            name: 'Polkadot',
            market_cap_rank: 20,
            current_price: 5.1,
          },
          {
            id: 'dot-clone',
            symbol: 'dot',
            name: 'Clone',
            market_cap_rank: 900,
            current_price: null,
          },
          // Ranks shifted while paging: the same coin again (regression, unique key).
          {
            id: 'polkadot',
            symbol: 'dot',
            name: 'Polkadot',
            market_cap_rank: 21,
            current_price: 5.1,
          },
          { id: 'no-symbol', symbol: '', name: 'X', market_cap_rank: 30 },
        ]),
        { status: 200 },
      );
    };
    const paced = new CoinGeckoDirectory(new SerialGate(0), fetcher, {
      publicPageMs: 0,
      retryAfterMs: 0,
    });
    const coins = await paced.topCoins('coingecko', 1000, {});
    expect(calls).toBe(2);
    expect(
      coins.map((c) => [c.id, c.symbol, c.marketCapRank, c.priceUsd]),
    ).toEqual([
      ['polkadot', 'DOT', 20, '5.1'],
      ['dot-clone', 'DOT', 900, null],
    ]);
  });

  it('identifies a token by chain + contract; an unlisted contract is undefined', async () => {
    const contract = '0xc28eb2250d1ae32c7e74cfb6d6b86afc9beb6509';
    const { fetcher, calls } = fakeFetch({
      [`/coins/ethereum/contract/${contract}`]: {
        status: 200,
        body: JSON.stringify({
          id: 'open-ticketing-ecosystem',
          symbol: 'opn',
          name: 'OPEN Ticketing Ecosystem',
          market_cap_rank: 3297,
          platforms: { ethereum: contract },
        }),
      },
    });
    expect(
      await directory(fetcher).byContract(
        'coingecko',
        'ethereum',
        contract,
        {},
      ),
    ).toMatchObject({ id: 'open-ticketing-ecosystem', symbol: 'OPN' });
    expect(calls[0]?.url).toBe(
      `https://api.coingecko.com/api/v3/coins/ethereum/contract/${contract}`,
    );
    expect(
      await directory(fetcher).byContract(
        'coingecko',
        'base',
        '0x0000000000000000000000000000000000000001',
        {},
      ),
    ).toBeUndefined();
  });
});
