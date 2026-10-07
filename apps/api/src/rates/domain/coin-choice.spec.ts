import {
  AMBIGUOUS_SYMBOLS,
  ambiguousSymbols,
  marketAmbiguity,
  type CoinChoices,
  coingeckoIdsOf,
  type MarketCoin,
  parseCoinChoices,
  SHARED_RANK_LIMIT,
  sharedTicker,
  priceSourceUsable,
  pricePlan,
  requiredCoinName,
  unresolvedAmbiguous,
} from './coin-choice';
import { COINGECKO_IDS } from './project-rate';

const OPEN: CoinChoices = {
  OPN: {
    provider: 'coingecko',
    id: 'open-ticketing-ecosystem',
    name: 'OPEN Ticketing Ecosystem',
    symbol: 'OPN',
  },
};

describe('coin per ticker (F7.4, OPN bug)', () => {
  it('OPN is OPEN Ticketing Ecosystem in the built-in table (verified at CoinGecko)', () => {
    expect(COINGECKO_IDS['OPN']).toBe('open-ticketing-ecosystem');
  });

  it('a chosen coin → only its provider; an ambiguous ticker → nothing; else by ticker', () => {
    expect(pricePlan('opn', OPEN)).toEqual({
      kind: 'chosen',
      choice: OPEN['OPN'],
    });
    expect(pricePlan('OPN', {})).toEqual({
      kind: 'ambiguous',
      candidates: ['open-ticketing-ecosystem', 'opinion'],
    });
    expect(pricePlan('DOT', {})).toEqual({
      kind: 'ticker',
      coingeckoId: 'polkadot',
    });
    expect(pricePlan('XYZ', {})).toEqual({ kind: 'ticker', coingeckoId: null });
    // A choice wins for any ticker, not only ambiguous ones.
    expect(
      pricePlan('DOT', {
        DOT: {
          provider: 'coingecko',
          id: 'polkadot',
          name: 'Polkadot',
          symbol: 'DOT',
        },
      }).kind,
    ).toBe('chosen');
  });

  it('a Binance price never counts for a chosen or ambiguous ticker', () => {
    expect(priceSourceUsable('OPN', 'binance', {})).toBe(false);
    expect(priceSourceUsable('OPN', 'binance', OPEN)).toBe(false);
    expect(priceSourceUsable('OPN', 'coingecko', OPEN)).toBe(true);
    expect(priceSourceUsable('OPN', 'manual', {})).toBe(true);
    expect(priceSourceUsable('DOT', 'binance', {})).toBe(true);
  });

  it('lists the ambiguous tickers without a choice; the list is small and documented', () => {
    expect(Object.keys(AMBIGUOUS_SYMBOLS).sort()).toEqual(['ONE', 'OPN']);
    for (const ids of Object.values(AMBIGUOUS_SYMBOLS)) {
      expect(ids.length).toBeGreaterThan(1);
    }
    expect(unresolvedAmbiguous({})).toEqual(['ONE', 'OPN']);
    expect(unresolvedAmbiguous(OPEN)).toEqual(['ONE']);
    expect(requiredCoinName('opn', OPEN)).toBe('OPEN Ticketing Ecosystem');
    expect(requiredCoinName('DOT', OPEN)).toBeUndefined();
  });

  describe('shared tickers from the market list', () => {
    const coin = (id: string, symbol: string, rank: number): MarketCoin => ({
      provider: 'coingecko',
      id,
      name: id,
      symbol,
      marketCapRank: rank,
      priceUsd: null,
    });
    const market = [
      coin('toncoin', 'TON', 10),
      coin('tokamak', 'TON', 800),
      coin('aaa', 'AAA', 400),
      coin('aaa-2', 'AAA', 900),
      coin('solo', 'SOLO', 50),
      coin('solo-clone', 'SOLO', 2500),
    ];

    it('a clear leader → warning; no clear leader → ambiguous; one relevant coin → nothing', () => {
      // 800 ≥ 3 × 10: Toncoin leads clearly — the price is used, the app asks to check.
      expect(sharedTicker('ton', market, {}, [])).toMatchObject({
        symbol: 'TON',
        level: 'warning',
        basis: 'market',
        candidates: [{ id: 'toncoin' }, { id: 'tokamak' }],
      });
      // 900 < 3 × 400: no clear leader — nothing is fetched by ticker.
      expect(sharedTicker('AAA', market, {}, [])).toMatchObject({
        level: 'ambiguous',
        basis: 'market',
      });
      // The clone ranks beyond SHARED_RANK_LIMIT: not relevant.
      expect(SHARED_RANK_LIMIT).toBe(2000);
      expect(sharedTicker('SOLO', market, {}, [])).toBeNull();
      expect(sharedTicker('XYZ', market, {}, [])).toBeNull();
    });

    it('"Passt so" and a chosen coin silence it; the hand-kept list cannot be dismissed', () => {
      expect(sharedTicker('TON', market, {}, ['TON'])).toBeNull();
      // Without a clear leader "Passt so" does not settle it — a coin must be chosen.
      expect(sharedTicker('AAA', market, {}, ['AAA'])).toMatchObject({
        level: 'ambiguous',
      });
      expect([...marketAmbiguity(market, {})]).toEqual([
        ['AAA', ['aaa', 'aaa-2']],
      ]);
      const aaa: CoinChoices = {
        AAA: { provider: 'coingecko', id: 'aaa', name: 'aaa', symbol: 'AAA' },
      };
      expect(marketAmbiguity(market, aaa).size).toBe(0);
      expect(ambiguousSymbols({}, marketAmbiguity(market, {}))).toEqual([
        'AAA',
        'ONE',
        'OPN',
      ]);
      expect(
        priceSourceUsable('AAA', 'binance', {}, marketAmbiguity(market, {})),
      ).toBe(false);
      expect(
        priceSourceUsable('TON', 'binance', {}, marketAmbiguity(market, {})),
      ).toBe(true);
      expect(
        sharedTicker(
          'TON',
          market,
          {
            TON: {
              provider: 'coingecko',
              id: 'toncoin',
              name: 'Toncoin',
              symbol: 'TON',
            },
          },
          [],
        ),
      ).toBeNull();
      expect(sharedTicker('OPN', [], {}, ['OPN'])).toMatchObject({
        level: 'ambiguous',
        basis: 'static',
      });
      expect(sharedTicker('OPN', [], OPEN, [])).toBeNull();
      // A market-ambiguous ticker is not fetched by ticker either.
      expect(
        pricePlan('AAA', {}, new Map([['AAA', ['aaa', 'aaa-2']]])).kind,
      ).toBe('ambiguous');
    });
  });

  it('reads stored choices and the older symbol → CoinGecko id shape; drops junk', () => {
    expect(
      parseCoinChoices({
        pol: 'polygon-ecosystem-token',
        OPN: {
          provider: 'coingecko',
          id: 'open-ticketing-ecosystem',
          name: 'OPEN Ticketing Ecosystem',
          symbol: 'opn',
        },
        BAD: { provider: 'nope', id: 'x' },
        WOPN: {
          provider: 'coingecko',
          id: 'open-ticketing-ecosystem',
          name: null,
          symbol: 'OPN',
          contract: {
            network: 'ethereum',
            address: '0xc28eb2250d1ae32c7e74cfb6d6b86afc9beb6509',
          },
        },
        JUNK: {
          provider: 'coingecko',
          id: 'bitcoin',
          contract: { network: 'bitcoin', address: 'x' },
        },
        UPPER: 'Not An Id',
        'a b': 'bitcoin',
      }),
    ).toEqual({
      POL: {
        provider: 'coingecko',
        id: 'polygon-ecosystem-token',
        name: null,
        symbol: null,
      },
      OPN: OPEN['OPN'],
      // A contract-identified coin keeps how it was found; an invalid contract is dropped.
      WOPN: {
        provider: 'coingecko',
        id: 'open-ticketing-ecosystem',
        name: null,
        symbol: 'OPN',
        contract: {
          network: 'ethereum',
          address: '0xc28eb2250d1ae32c7e74cfb6d6b86afc9beb6509',
        },
      },
      JUNK: { provider: 'coingecko', id: 'bitcoin', name: null, symbol: null },
    });
    expect(parseCoinChoices([])).toEqual({});
    expect(parseCoinChoices(null)).toEqual({});
    expect(coingeckoIdsOf(OPEN)).toEqual({ OPN: 'open-ticketing-ecosystem' });
  });
});
