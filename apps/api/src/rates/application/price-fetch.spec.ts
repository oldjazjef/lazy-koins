import {
  chRules,
  RateTable,
  unitPriceChf,
  withTaxCurrency,
} from '@lazykoins/engine';
import type { CoinChoices } from '../domain/coin-choice';
import { FakePriceHistorySources } from '../testing/fake-price-history';
import { FakeUsdSource } from '../testing/in-memory-project-rate.repository';
import {
  CoinRefCache,
  fetchPrices,
  type PriceRequest,
  seriesCounts,
} from './price-fetch';

function sources(usdPrices: Record<string, string> = {}) {
  const history = new FakePriceHistorySources();
  // No CoinGecko answer unless a test asks for one.
  history.fake('coingecko').prices = {};
  return {
    usd: new FakeUsdSource(usdPrices),
    history,
    coins: new CoinRefCache(),
  };
}

const base: PriceRequest = {
  asset: 'XYZ',
  from: '2024-12-01',
  to: '2026-01-15',
  currency: 'CHF',
  choices: {},
  keys: { coingecko: 'cg-key', coinmarketcap: 'cmc-key' },
};

describe('provider chain (price sources phase 2)', () => {
  it('asks the enabled providers in the user order and stops at the first series', async () => {
    const s = sources({ XYZ: '2' });
    s.history.fake('kraken').prices = { XYZ: '3' };
    const found = await fetchPrices(s, {
      ...base,
      providers: ['kraken', 'binance'],
    });
    expect(found).toMatchObject({ status: 'fetched', source: 'kraken' });
    expect(found.entries.every((e) => e.source === 'kraken')).toBe(true);
    // Kraken prices CHF directly — no USD detour.
    expect(found.entries.every((e) => e.currency === 'CHF')).toBe(true);
    expect(s.usd.calls).toEqual([]);
  });

  it('falls back on notFound, planLacksHistory, unsupportedQuote and an empty series', async () => {
    const s = sources();
    s.history
      .fake('coinmarketcap')
      .symbols.set('XYZ', [{ id: '77', symbol: 'XYZ', name: 'Xyz', rank: 50 }]);
    s.history.fake('coinmarketcap').failWith = {
      code: 'planLacksHistory',
      status: 403,
    };
    s.history.fake('kraken').failWith = { code: 'notFound', status: null };
    s.history.fake('coinbase').prices = { XYZ: '4' };
    const found = await fetchPrices(s, {
      ...base,
      currency: 'CHF',
      // Binance: empty; CMC: plan; Kraken: unknown pair; Bitfinex: no CHF → USD (empty);
      // Coinbase: no CHF → USD.
      providers: ['binance', 'coinmarketcap', 'kraken', 'bitfinex', 'coinbase'],
    });
    expect(found.attempts.map((a) => [a.provider, a.outcome])).toEqual([
      ['binance', 'empty'],
      ['coinmarketcap', 'planLacksHistory'],
      ['kraken', 'notFound'],
      ['bitfinex', 'empty'],
      ['coinbase', 'fetched'],
    ]);
    expect(found).toMatchObject({ status: 'fetched', source: 'coinbase' });
    // USD-only for CHF: stored in USD, the engine multiplies by USD/CHF of the day.
    expect(new Set(found.entries.map((e) => e.currency))).toEqual(
      new Set(['USD']),
    );
    // CMC answered (with a plan error) — its key is fine.
    expect(found.keysAccepted).toEqual(['coinmarketcap']);
  });

  it('moves on after a hard failure; nothing anywhere = failed with the first code', async () => {
    const s = sources();
    s.history.fake('kraken').failWith = { code: 'rateLimited', status: 429 };
    s.history.fake('bitfinex').prices = { XYZ: '9' };
    const fallback = await fetchPrices(s, {
      ...base,
      currency: 'USD',
      providers: ['kraken', 'bitfinex'],
    });
    expect(fallback).toMatchObject({ status: 'fetched', source: 'bitfinex' });

    s.history.fake('bitfinex').prices = {};
    s.history
      .fake('coinmarketcap')
      .symbols.set('XYZ', [{ id: '77', symbol: 'XYZ', name: 'Xyz', rank: 50 }]);
    s.history.fake('coinmarketcap').failWith = {
      code: 'invalidKey',
      status: 401,
    };
    const failed = await fetchPrices(s, {
      ...base,
      providers: ['coinmarketcap', 'kraken', 'bitfinex'],
    });
    expect(failed).toMatchObject({
      status: 'failed',
      error: { provider: 'coinmarketcap', code: 'invalidKey' },
      keysRejected: ['coinmarketcap'],
    });
  });

  it('CoinGecko answers without a key (public API); CoinMarketCap is skipped without one', async () => {
    const s = sources({ XYZ: '2' });
    s.history.fake('coingecko').prices = { '*': '1.5' };
    s.history.fake('coinmarketcap').prices = { '*': '1.6' };
    // Regression (07.10.2026): without a Demo key CoinGecko used to be skipped ("Schlüssel des
    // Anbieters fehlt"), so a coin chosen there never got a price.
    const keyless = await fetchPrices(s, {
      ...base,
      asset: 'ETH',
      keys: {},
    });
    expect(keyless).toMatchObject({ status: 'fetched', source: 'coingecko' });
    expect(s.history.callsOf('coingecko')[0]).not.toHaveProperty('apiKey');
    const cmcOnly = await fetchPrices(s, {
      ...base,
      asset: 'ETH',
      keys: {},
      providers: ['coinmarketcap'],
    });
    expect(cmcOnly.attempts.map((a) => [a.provider, a.outcome])).toEqual([
      ['coinmarketcap', 'noKey'],
    ]);
    const keyed = await fetchPrices(s, { ...base, asset: 'ETH' });
    expect(keyed).toMatchObject({ status: 'fetched', source: 'coingecko' });
    expect(s.history.callsOf('coingecko').at(-1)).toMatchObject({
      coin: 'ethereum',
      quote: 'CHF',
      apiKey: 'cg-key',
    });
  });

  describe('coin identification', () => {
    it('an ambiguous ticker is never priced — at no provider', async () => {
      const s = sources({ OPN: '900' });
      for (const id of ['kraken', 'coinbase', 'bitfinex', 'coinpaprika']) {
        s.history.fake(id as 'kraken').prices = { '*': '1' };
      }
      const found = await fetchPrices(s, {
        ...base,
        asset: 'OPN',
        providers: [
          'binance',
          'coingecko',
          'coinmarketcap',
          'defillama',
          'coinpaprika',
          'kraken',
          'coinbase',
          'bitfinex',
        ],
      });
      expect(found).toMatchObject({ status: 'ambiguous', entries: [] });
      expect(s.usd.calls).toEqual([]);
      expect(s.history.calls).toEqual([]);
      // Also a ticker the market list shows without a clear leader.
      const market = await fetchPrices(s, {
        ...base,
        asset: 'ABC',
        providers: ['kraken'],
        marketAmbiguous: new Map([['ABC', ['abc-one', 'abc-two']]]),
      });
      expect(market.status).toBe('ambiguous');
      expect(s.history.calls).toEqual([]);
    });

    it('a symbol lookup without a clear leader is ambiguous at that provider — the next one is asked', async () => {
      const s = sources();
      s.history.fake('coinpaprika').symbols.set('XYZ', [
        { id: 'xyz-one', symbol: 'XYZ', name: 'One', rank: 100 },
        { id: 'xyz-two', symbol: 'XYZ', name: 'Two', rank: 150 },
      ]);
      s.history.fake('coinpaprika').prices = { '*': '1' };
      s.history.fake('coinmarketcap').symbols.set('XYZ', [
        { id: '1', symbol: 'XYZ', name: 'Leader', rank: 10 },
        { id: '2', symbol: 'XYZ', name: 'Far behind', rank: 900 },
      ]);
      s.history.fake('coinmarketcap').prices = { '1': '5' };
      const found = await fetchPrices(s, {
        ...base,
        providers: ['coinpaprika', 'coinmarketcap'],
      });
      expect(found.attempts.map((a) => [a.provider, a.outcome])).toEqual([
        ['coinpaprika', 'ambiguous'],
        ['coinmarketcap', 'fetched'],
      ]);
      expect(s.history.callsOf('coinpaprika')).toEqual([]);
      expect(s.history.callsOf('coinmarketcap')[0]).toMatchObject({
        coin: '1',
        quote: 'CHF',
      });
      // The lookup is cached: a second asset run asks the directory no more.
      await fetchPrices(s, { ...base, providers: ['coinmarketcap'] });
      expect(s.history.fake('coinmarketcap').resolveCalls).toEqual([
        'symbol:XYZ',
      ]);
    });

    it('DefiLlama prices a ticker only through a known CoinGecko id (built-in or market leader)', async () => {
      const s = sources();
      s.history.fake('defillama').prices = {
        'coingecko:polkadot': '4',
        'coingecko:xyz-coin': '7',
      };
      const builtIn = await fetchPrices(s, {
        ...base,
        asset: 'DOT',
        providers: ['defillama'],
      });
      expect(builtIn).toMatchObject({ status: 'fetched', source: 'defillama' });
      expect(builtIn.entries[0]?.currency).toBe('USD');
      const unknown = await fetchPrices(s, {
        ...base,
        providers: ['defillama'],
      });
      expect(unknown.attempts[0]?.outcome).toBe('noCoin');
      const leader = await fetchPrices(s, {
        ...base,
        providers: ['defillama'],
        marketLeader: 'xyz-coin',
      });
      expect(leader.status).toBe('fetched');
    });

    it('a chosen coin: its provider first (even when off), then only providers of the same coin — never a ticker source', async () => {
      const s = sources({ OPN: '900' });
      s.history.fake('kraken').prices = { '*': '1' };
      s.history.fake('defillama').prices = {
        'coingecko:open-ticketing-ecosystem': '0.02',
      };
      const choices: CoinChoices = {
        OPN: {
          provider: 'coingecko',
          id: 'open-ticketing-ecosystem',
          name: 'OPEN Ticketing Ecosystem',
          symbol: 'OPN',
        },
      };
      const found = await fetchPrices(s, {
        ...base,
        asset: 'OPN',
        choices,
        keys: {},
        providers: ['binance', 'kraken', 'defillama'],
      });
      // CoinGecko is asked without a key (public API); it has nothing here → DefiLlama.
      expect(found.attempts.map((a) => [a.provider, a.outcome])).toEqual([
        ['coingecko', 'empty'],
        ['defillama', 'fetched'],
      ]);
      expect(found.source).toBe('defillama');
      expect(s.usd.calls).toEqual([]);
      expect(s.history.callsOf('kraken')).toEqual([]);
      // Regression (07.10.2026): a coin chosen at CoinGecko is priced without a Demo key.
      s.history.fake('coingecko').prices = {
        'open-ticketing-ecosystem': '0.021',
      };
      const keyless = await fetchPrices(s, {
        ...base,
        asset: 'OPN',
        choices,
        keys: {},
        providers: ['binance', 'kraken'],
      });
      expect(keyless).toMatchObject({ status: 'fetched', source: 'coingecko' });
      expect(s.history.callsOf('kraken')).toEqual([]);
    });

    it('a chosen CoinMarketCap coin is asked by its CMC id; a contract coin also at the contract providers', async () => {
      const s = sources();
      s.history.fake('coinmarketcap').prices = { '3001': '0.5' };
      const cmc = await fetchPrices(s, {
        ...base,
        asset: 'OPN',
        choices: {
          OPN: {
            provider: 'coinmarketcap',
            id: '3001',
            name: 'Opinion',
            symbol: 'OPN',
          },
        },
        providers: ['binance', 'coingecko'],
      });
      expect(cmc).toMatchObject({ status: 'fetched', source: 'coinmarketcap' });
      expect(s.history.callsOf('coinmarketcap')[0]).toMatchObject({
        coin: '3001',
        apiKey: 'cmc-key',
      });

      s.history.fake('coinmarketcap').prices = {};
      s.history
        .fake('defillama')
        .contracts.set('base:0xabc', [
          { id: 'base:0xabc', symbol: 'TOK', name: null, rank: null },
        ]);
      s.history.fake('defillama').prices = { 'base:0xabc': '0.1' };
      const byContract = await fetchPrices(s, {
        ...base,
        asset: 'TOK',
        choices: {
          TOK: {
            provider: 'coinmarketcap',
            id: '42',
            name: 'Token',
            symbol: 'TOK',
            contract: { network: 'base', address: '0xabc' },
          },
        },
        providers: ['kraken', 'defillama'],
      });
      expect(byContract.attempts.map((a) => [a.provider, a.outcome])).toEqual([
        ['coinmarketcap', 'empty'],
        ['defillama', 'fetched'],
      ]);
    });
  });

  describe('day semantics: the value for UTC day D is the close of D', () => {
    it('start-of-day providers are asked a day later and filed a day earlier', async () => {
      const s = sources();
      s.history
        .fake('coinmarketcap')
        .symbols.set('XYZ', [{ id: '9', symbol: 'XYZ', name: 'Xyz', rank: 1 }]);
      // The provider's 00:00 snapshots of 31.12. and 01.01.
      const cmc = s.history.fake('coinmarketcap');
      cmc.prices = { '9': '100' };
      cmc.dates = () => ['2025-12-31', '2026-01-01'];
      const found = await fetchPrices(s, {
        ...base,
        from: '2025-12-30',
        to: '2025-12-31',
        providers: ['coinmarketcap'],
      });
      expect(s.history.callsOf('coinmarketcap')[0]).toMatchObject({
        from: '2025-12-31',
        to: '2026-01-01',
      });
      // 00:00 on 01.01. = the close of 31.12.; 00:00 on 31.12. = the close of 30.12.
      expect(found.entries.map((e) => e.date)).toEqual([
        '2025-12-30',
        '2025-12-31',
      ]);
    });

    it('close providers are filed on their own day', async () => {
      const s = sources();
      const kraken = s.history.fake('kraken');
      kraken.prices = { XYZ: '100' };
      kraken.dates = () => ['2025-12-30', '2025-12-31'];
      const found = await fetchPrices(s, {
        ...base,
        from: '2025-12-30',
        to: '2025-12-31',
        providers: ['kraken'],
      });
      expect(s.history.callsOf('kraken')[0]).toMatchObject({
        from: '2025-12-30',
        to: '2025-12-31',
      });
      expect(found.entries.map((e) => e.date)).toEqual([
        '2025-12-30',
        '2025-12-31',
      ]);
    });

    it('CoinGecko is always asked for more than 90 days (one 00:00 point per day)', async () => {
      const s = sources();
      s.history.fake('coingecko').prices = { '*': '1' };
      await fetchPrices(s, {
        ...base,
        asset: 'ETH',
        from: '2025-12-20',
        to: '2025-12-31',
        providers: ['coingecko'],
      });
      expect(s.history.callsOf('coingecko')[0]).toMatchObject({
        from: '2025-10-02',
        to: '2026-01-01',
      });
    });
  });

  it('a USD-only series is valued × USD/T of the day (engine price priority unchanged)', async () => {
    const s = sources();
    s.history.fake('defillama').prices = { 'coingecko:polkadot': '5' };
    const found = await fetchPrices(s, {
      ...base,
      asset: 'DOT',
      currency: 'EUR',
      providers: ['defillama'],
    });
    const table = new RateTable(
      [
        ...found.entries,
        {
          kind: 'fx',
          asset: 'USD',
          currency: 'EUR',
          date: '2025-12-31',
          value: '0.86',
          source: 'ecb',
        },
      ],
      'EUR',
    );
    const quote = unitPriceChf(
      table,
      withTaxCurrency(chRules, 'EUR'),
      'DOT',
      '2025-12-31',
    );
    expect(quote).toMatchObject({ origin: 'tableUsd', source: 'defillama' });
    expect(quote?.priceChf.toFixed()).toBe('4.3');
  });

  it('seriesCounts: a chosen CoinGecko coin counts its own and DefiLlama series, never a ticker source', () => {
    const choices: CoinChoices = {
      OPN: { provider: 'coingecko', id: 'x', name: null, symbol: null },
    };
    expect(seriesCounts('OPN', 'coingecko', choices)).toBe(true);
    expect(seriesCounts('OPN', 'defillama', choices)).toBe(true);
    for (const source of [
      'binance',
      'kraken',
      'coinmarketcap',
      'coinpaprika',
    ]) {
      expect(seriesCounts('OPN', source, choices)).toBe(false);
    }
    expect(seriesCounts('ONE', 'kraken', {})).toBe(false);
    expect(seriesCounts('DOT', 'kraken', {})).toBe(true);
  });
});
