import { FakePriceHistorySources } from '../../rates/testing/fake-price-history';
import {
  BadGatewayException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import {
  CalculateProjectCommand,
  GetResultQuery,
} from '../../calculation/application/calculation.handlers';
import { InMemoryUserRateRepository } from '../../carryover/testing/in-memory-carryover.repositories';
import type { Env } from '../../config/env';
import {
  SettingsReader,
  SettingsSecrets,
} from '../../settings/application/settings.handlers';
import type { EstvVersion } from '../domain/estv';
import { crypto, fx, InMemoryEstvRepository } from '../testing/in-memory-estv';
import {
  FakeCoinDirectory,
  FakeFxSource,
  FakeUsdSource,
} from '../testing/in-memory-project-rate.repository';
import { CoinMarketService } from './coin-market.service';
import { ContractCoinResolver, walletContracts } from './contract-coins';
import {
  ListProjectHintsHandler,
  ListProjectHintsQuery,
} from '../../files/application/queries/project-hints.query';
import { InMemoryHintStateRepository } from '../../files/testing/in-memory-hint-state.repository';
import {
  ChooseProjectCoinCommand,
  ChooseProjectCoinHandler,
  CoinChoiceService,
  DismissSharedTickerCommand,
  DismissSharedTickerHandler,
  GetCoinHandler,
  GetCoinQuery,
  SearchCoinsHandler,
  SearchCoinsQuery,
  SetCoinChoiceCommand,
  SetCoinChoiceHandler,
} from './coin-choice.handlers';
import { EstvProjectRatesService } from './estv-project-rates.service';
import {
  GetRatesHandler,
  GetRatesQuery,
  type RatesView,
  RefreshRatesCommand,
  RefreshRatesHandler,
} from './rates.handlers';
import { RefreshProgress } from './refresh-progress';

/** A synthetic MetaMask statement holding OPN at 31.12. (the reported case). */
const OPN_CSV = [
  'Plattform,Konto,Asset,Menge,Stichtag,Preis CHF,Preis USD,Beleg',
  'metamask,ethereum,OPN,1000,2025-12-31,,,',
].join('\n');

const OPEN_TICKETING = {
  provider: 'coingecko' as const,
  id: 'open-ticketing-ecosystem',
};

async function setup(online: 'true' | 'false' = 'true') {
  const t = await calculationSetup();
  await t.addFile('metamask.csv', OPN_CSV);
  const config = {
    get: (key: string) =>
      key === 'RATES_ONLINE'
        ? online
        : key === 'SETTINGS_ENCRYPTION_KEY'
          ? 'a-test-key-that-is-long-enough-for-aes-256-gcm'
          : undefined,
  } as unknown as ConfigService<Env, true>;
  const secrets = new SettingsSecrets(config);
  const settings = new SettingsReader(t.userSettings, secrets);
  await t.userSettings.save('anna', {
    sealedKeys: { coingecko: secrets.box.seal('CG-key') },
  });
  // Binance's OPN is another coin (Opinion): a price far off the ticketing token's.
  const usd = new FakeUsdSource({ DOT: '5', OPN: '900' });
  const fiat = new FakePriceHistorySources();
  const estvStore = new InMemoryEstvRepository();
  const estv = new EstvProjectRatesService(estvStore, t.rates, t.inputs);
  const userRates = new InMemoryUserRateRepository();
  const directory = new FakeCoinDirectory();
  // The calculation reads the same market list (market-ambiguous tickers → open item).
  const marketRepo = t.market;
  const markets = new CoinMarketService(directory, marketRepo);
  const coins = new CoinChoiceService(
    directory,
    settings,
    t.userSettings,
    t.projects,
    t.rates,
    userRates,
    config,
  );
  const refresh = new RefreshRatesHandler(
    t.projects,
    t.rates,
    t.inputs,
    settings,
    usd,
    fiat,
    new FakeFxSource(),
    config,
    new RefreshProgress(),
    estv,
    undefined,
    markets,
    new ContractCoinResolver(t.wallets, coins),
  );
  return {
    ...t,
    usd,
    fiat,
    estvStore,
    userRates,
    directory,
    marketRepo,
    markets,
    refresh,
    getRates: new GetRatesHandler(
      t.projects,
      t.rates,
      settings,
      config,
      estvStore,
      t.snapshots,
      markets,
    ),
    dismiss: new DismissSharedTickerHandler(t.userSettings),
    hints: new ListProjectHintsHandler(
      t.projects,
      t.files,
      new InMemoryHintStateRepository(),
      t.snapshots,
      marketRepo,
      t.userSettings,
    ),
    search: new SearchCoinsHandler(coins),
    getCoin: new GetCoinHandler(coins),
    setChoice: new SetCoinChoiceHandler(coins),
    choose: new ChooseProjectCoinHandler(t.projects, coins, refresh),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const opnRates = async (t: Setup) =>
  (await t.rates.listByProject(t.project.id))
    .filter((r) => r.asset === 'OPN')
    .map((r) => `${r.source}:${r.currency}:${r.value}`);

async function opnPosition(t: Setup) {
  await t.calculate.execute(new CalculateProjectCommand('anna', t.project.id));
  const view = await t.result.execute(new GetResultQuery('anna', t.project.id));
  return {
    position: view.result?.positions.find((p) => p.asset === 'OPN'),
    items: (view.result?.openItems ?? []).filter((i) => i.asset === 'OPN'),
  };
}

describe('OPN priced as another coin (regression, F7.4)', () => {
  it('a ticker of several coins without a chosen coin gets no Binance price — an open item instead', async () => {
    const t = await setup();
    // A series fetched before the fix (Opinion's close on Binance).
    await t.rates.upsertMany(t.project.id, [
      {
        kind: 'price',
        asset: 'OPN',
        currency: 'USD',
        date: '2025-12-31',
        value: '900',
        source: 'binance',
      },
    ]);
    // Already at read time the old by-ticker price does not count.
    const before = await opnPosition(t);
    expect(before.position).toMatchObject({
      status: 'missingPrice',
      valueChf: null,
    });
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, true),
    );
    expect(summary.assets.find((a) => a.asset === 'OPN')).toEqual({
      asset: 'OPN',
      status: 'ambiguous',
      source: null,
      points: 0,
    });
    expect(t.usd.calls.map((c) => c.symbol)).not.toContain('OPN');
    expect(t.fiat.calls.map((c) => c.coin)).not.toContain(
      'open-ticketing-ecosystem',
    );
    expect(await opnRates(t)).toEqual([]);
    const after = await opnPosition(t);
    expect(after.position).toMatchObject({
      status: 'missingPrice',
      valueChf: null,
    });
    // F8.2: one stable item "Kurs mehrdeutig – Coin wählen" (never a silent price).
    expect(after.items.map((i) => [i.key, i.reason])).toContainEqual([
      'ambiguousPrice:OPN',
      'ambiguousPrice',
    ]);
    const view = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(view.assets.find((a) => a.asset === 'OPN')).toMatchObject({
      pricing: 'ambiguous',
      coin: null,
      suggested: 'open-ticketing-ecosystem',
    });
  });

  it('with a coin chosen, Binance is skipped and only CoinGecko with that id is asked', async () => {
    const t = await setup();
    await t.setChoice.execute(
      new SetCoinChoiceCommand('anna', 'opn', OPEN_TICKETING),
    );
    // DOT too: a chosen coin wins over the ticker for any symbol.
    await t.setChoice.execute(
      new SetCoinChoiceCommand('anna', 'DOT', {
        provider: 'coingecko',
        id: 'polkadot',
      }),
    );
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.assets.find((a) => a.asset === 'OPN')).toMatchObject({
      status: 'fetched',
      source: 'coingecko',
    });
    expect(summary.assets.find((a) => a.asset === 'DOT')).toMatchObject({
      source: 'coingecko',
    });
    expect(t.usd.calls.map((c) => c.symbol)).not.toContain('OPN');
    expect(t.usd.calls.map((c) => c.symbol)).not.toContain('DOT');
    expect(t.fiat.calls.map((c) => c.coin)).toEqual(
      expect.arrayContaining(['open-ticketing-ecosystem', 'polkadot']),
    );
    expect(await opnRates(t)).toEqual([
      'coingecko:CHF:1.5',
      'coingecko:CHF:1.5',
      'coingecko:CHF:1.5',
    ]);
    const { position, items } = await opnPosition(t);
    expect(position).toMatchObject({ status: 'ok', valueChf: '1500' });
    expect(items).toEqual([]);
  });

  it('without a CoinGecko key a chosen coin is still priced at CoinGecko (public API), never by Binance', async () => {
    // Regression (07.10.2026): every coin chosen at CoinGecko showed "Schlüssel des Anbieters
    // fehlt" for a user without a Demo key.
    const t = await setup();
    await t.setChoice.execute(
      new SetCoinChoiceCommand('anna', 'OPN', OPEN_TICKETING),
    );
    await t.userSettings.save('anna', { sealedKeys: { coingecko: null } });
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.assets.find((a) => a.asset === 'OPN')?.status).not.toBe(
      'noKey',
    );
    expect(t.usd.calls.map((c) => c.symbol)).not.toContain('OPN');
  });
});

describe('"Coin wählen" (F7.4)', () => {
  it('searches the directory, exact symbol first, with the built-in suggestion', async () => {
    const t = await setup();
    const found = await t.search.execute(
      new SearchCoinsQuery('anna', 'coingecko', 'OPN'),
    );
    expect(found.coins.map((c) => c.id)).toEqual([
      'opinion',
      'open-ticketing-ecosystem',
    ]);
    expect(found).toMatchObject({
      suggested: 'open-ticketing-ecosystem',
      ambiguous: true,
    });
  });

  it('CoinMarketCap as a coin provider: needs its key; a chosen CMC coin is priced by CMC only', async () => {
    const t = await setup();
    await expect(
      t.search.execute(new SearchCoinsQuery('anna', 'coinmarketcap', 'OPN')),
    ).rejects.toMatchObject({ response: { code: 'noKey' } });
    expect(t.directory.calls).toEqual([]);
    const box = new SettingsSecrets({
      get: () => 'a-test-key-that-is-long-enough-for-aes-256-gcm',
    } as unknown as ConfigService<Env, true>).box;
    await t.userSettings.save('anna', {
      sealedKeys: { coinmarketcap: box.seal('CMC-key') },
    });
    t.directory.coins.push({
      provider: 'coinmarketcap',
      id: '3001',
      name: 'OPEN Ticketing Ecosystem',
      symbol: 'OPN',
      marketCapRank: 3301,
    });
    await t.setChoice.execute(
      new SetCoinChoiceCommand('anna', 'OPN', {
        provider: 'coinmarketcap',
        id: '3001',
      }),
    );
    t.fiat.fake('coinmarketcap').prices = { '3001': '0.03' };
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.assets.find((a) => a.asset === 'OPN')).toMatchObject({
      status: 'fetched',
      source: 'coinmarketcap',
    });
    expect(t.usd.calls.map((c) => c.symbol)).not.toContain('OPN');
    expect(t.fiat.callsOf('coinmarketcap')).toEqual([
      expect.objectContaining({
        coin: '3001',
        quote: 'CHF',
        apiKey: 'CMC-key',
      }),
    ]);
    expect([
      ...new Set((await opnRates(t)).map((r) => r.split(':')[0])),
    ]).toEqual(['coinmarketcap']);
  });

  it('validates an id: name + symbol, unknown = 422, offline = 409, provider down = 502', async () => {
    const t = await setup();
    expect(
      await t.getCoin.execute(
        new GetCoinQuery('anna', 'coingecko', 'open-ticketing-ecosystem'),
      ),
    ).toMatchObject({ name: 'OPEN Ticketing Ecosystem', symbol: 'OPN' });
    await expect(
      t.getCoin.execute(new GetCoinQuery('anna', 'coingecko', 'no-such-coin')),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    t.directory.failWithStatus = 429;
    await expect(
      t.getCoin.execute(new GetCoinQuery('anna', 'coingecko', 'opinion')),
    ).rejects.toBeInstanceOf(BadGatewayException);
    const offline = await setup('false');
    await expect(
      offline.search.execute(new SearchCoinsQuery('anna', 'coingecko', 'OPN')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(offline.directory.calls).toEqual([]);
    // Nothing is stored for an unknown coin.
    await expect(
      t.setChoice.execute(
        new SetCoinChoiceCommand('anna', 'OPN', {
          provider: 'coingecko',
          id: 'nope',
        }),
      ),
    ).rejects.toThrow();
    expect((await t.userSettings.find('anna'))?.coinChoices).toEqual({});
  });

  it('from the Kurse tab: stores the coin, removes the wrong series everywhere, refetches (force) — the result turns stale', async () => {
    const t = await setup();
    const wrong = {
      kind: 'price' as const,
      asset: 'OPN',
      currency: 'USD',
      date: '2025-12-31',
      value: '900',
      source: 'binance' as const,
    };
    await t.rates.upsertMany(t.project.id, [
      wrong,
      { ...wrong, source: 'manual', currency: 'CHF', value: '0.02' },
    ]);
    await t.userRates.upsertMany('anna', [wrong, { ...wrong, asset: 'DOT' }]);
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(
      (await t.result.execute(new GetResultQuery('anna', t.project.id))).stale,
    ).toBe(false);

    const answer = await t.choose.execute(
      new ChooseProjectCoinCommand('anna', t.project.id, 'opn', OPEN_TICKETING),
    );
    expect(answer).toMatchObject({
      symbol: 'OPN',
      choice: {
        provider: 'coingecko',
        id: 'open-ticketing-ecosystem',
        name: 'OPEN Ticketing Ecosystem',
        symbol: 'OPN',
      },
      removed: { projectRates: 1, userRates: 1 },
      fetch: { status: 'fetched', source: 'coingecko', points: 3 },
    });
    // Only this asset was fetched (no FX, no other asset), from CoinGecko only.
    expect(t.usd.calls).toEqual([]);
    expect(t.fiat.calls.map((c) => c.coin)).toEqual([
      'open-ticketing-ecosystem',
    ]);
    // The override stays (one day); the Binance series is gone, CoinGecko's is there.
    expect((await opnRates(t)).sort()).toEqual([
      'coingecko:CHF:1.5',
      'coingecko:CHF:1.5',
      'coingecko:CHF:1.5',
      'manual:CHF:0.02',
    ]);
    expect((await t.userRates.listByUser('anna')).map((r) => r.asset)).toEqual([
      'DOT',
    ]);
    expect(
      (await t.result.execute(new GetResultQuery('anna', t.project.id))).stale,
    ).toBe(true);
    const view = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(view.assets.find((a) => a.asset === 'OPN')).toMatchObject({
      pricing: 'chosen',
      coin: { id: 'open-ticketing-ecosystem' },
      sources: ['coingecko'],
      ignored: [],
      overridden: true,
    });
  });

  it('a coin chosen in the settings makes the calculation stale at once (the by-ticker price stops counting)', async () => {
    const t = await setup();
    await t.rates.upsertMany(t.project.id, [
      {
        kind: 'price',
        asset: 'DOT',
        currency: 'USD',
        date: '2025-12-31',
        value: '5',
        source: 'binance',
      },
    ]);
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    await t.setChoice.execute(
      new SetCoinChoiceCommand('anna', 'DOT', {
        provider: 'coingecko',
        id: 'polkadot',
      }),
    );
    expect(
      (await t.result.execute(new GetResultQuery('anna', t.project.id))).stale,
    ).toBe(true);
    // Removing it again: the ticker rules apply, the choice is gone.
    const removed = await t.setChoice.execute(
      new SetCoinChoiceCommand('anna', 'DOT', null),
    );
    expect(removed.choices).toEqual({});
  });

  it('refuses a closed project', async () => {
    const t = await setup();
    await t.projects.update(t.project.id, { status: 'closed' });
    await expect(
      t.choose.execute(
        new ChooseProjectCoinCommand(
          'anna',
          t.project.id,
          'OPN',
          OPEN_TICKETING,
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

const version: EstvVersion = {
  year: 2025,
  exportType: 'THIRD.INIT.220',
  exportDate: '2026-03-02T08:00:00.000Z',
  fileHash: 'h1',
  fileName: 'kursliste_2025.zip',
  schemaVersion: '2.2.0',
  downloadedAt: '2026-03-02T08:00:00.000Z',
  entryCount: 2,
  cryptoCount: 1,
};

describe('ESTV match with a chosen coin (F7.4a)', () => {
  it('a single ticker hit is taken only when its name is the chosen coin', async () => {
    const t = await setup();
    await t.estvStore.replaceYear(version, [
      crypto('OPN', 'Opinion', '0.9', '1'),
      fx('USD', '0.79'),
    ]);
    // No coin chosen: OPN is ambiguous — no ESTV value either.
    let summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.estv.ambiguous).toEqual([
      expect.objectContaining({ asset: 'OPN', reason: 'ambiguousSymbol' }),
    ]);
    await t.setChoice.execute(
      new SetCoinChoiceCommand('anna', 'OPN', OPEN_TICKETING),
    );
    summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.estv.matched.map((m) => m.asset)).not.toContain('OPN');
    expect(summary.estv.ambiguous).toEqual([
      expect.objectContaining({ asset: 'OPN', reason: 'coinMismatch' }),
    ]);
    expect(
      (await t.rates.listByProject(t.project.id)).some(
        (r) => r.asset === 'OPN' && r.source === 'estv',
      ),
    ).toBe(false);

    await t.estvStore.replaceYear(version, [
      crypto('OPN', 'OPEN Ticketing Ecosystem', '0.015', '2'),
      fx('USD', '0.79'),
    ]);
    summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.estv.matched).toEqual([
      expect.objectContaining({ asset: 'OPN', value: '0.015' }),
    ]);
  });
});

const market = (id: string, symbol: string, rank: number) => ({
  provider: 'coingecko' as const,
  id,
  name: id === 'polkadot' ? 'Polkadot' : id,
  symbol,
  marketCapRank: rank,
  priceUsd: '4',
});

describe('shared tickers: warnings from the market list (F7.4)', () => {
  it('loads the market list at most daily, only with lookups on', async () => {
    const t = await setup();
    t.directory.market = [market('polkadot', 'DOT', 20)];
    await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(t.directory.calls.filter((c) => c.startsWith('top:'))).toEqual([
      'top:2000',
    ]);
    expect(t.marketRepo.rows).toHaveLength(1);
    // A day later it is fetched again; a failure keeps the old list and never fails the refresh.
    t.directory.failWithStatus = 503;
    await t.markets.refreshIfStale(
      undefined,
      new Date(Date.now() + 2 * 86_400_000),
    );
    expect(t.marketRepo.rows).toHaveLength(1);
  });

  it('a clear leader: the price is used, the Kurse tab and the hints warn; "Passt so" and a chosen coin silence it', async () => {
    const t = await setup();
    t.directory.market = [
      market('polkadot', 'DOT', 20),
      market('dot-clone', 'DOT', 900),
    ];
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.assets.find((a) => a.asset === 'DOT')).toMatchObject({
      status: 'fetched',
      source: 'binance',
    });
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const view = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(view.assets.find((a) => a.asset === 'DOT')).toMatchObject({
      pricing: 'ticker',
      sources: ['binance'],
      shared: {
        level: 'warning',
        basis: 'market',
        candidates: [{ id: 'polkadot' }, { id: 'dot-clone' }],
      },
    });
    const hints = await t.hints.execute(
      new ListProjectHintsQuery('anna', t.project.id),
    );
    expect(hints.hints.find((h) => h.key === 'sharedTicker:DOT')).toMatchObject(
      {
        key: 'sharedTicker:DOT',
        severity: 'warning',
        asset: 'DOT',
        coins: ['Polkadot (#20)', 'dot-clone (#900)'],
      },
    );
    // The open item list is not touched (the price is used); statements never show it.
    const result = await t.result.execute(
      new GetResultQuery('anna', t.project.id),
    );
    expect(
      result.result?.openItems.some(
        (i) => i.asset === 'DOT' && i.reason === 'ambiguousPrice',
      ),
    ).toBe(false);

    // "Passt so": stored per user + ticker, gone everywhere.
    await t.dismiss.execute(
      new DismissSharedTickerCommand('anna', 'dot', true),
    );
    expect((await t.userSettings.find('anna'))?.coinDismissed).toEqual(['DOT']);
    let after = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(after.assets.find((a) => a.asset === 'DOT')?.shared).toBeNull();
    expect(
      (
        await t.hints.execute(new ListProjectHintsQuery('anna', t.project.id))
      ).hints.some((h) => h.key === 'sharedTicker:DOT'),
    ).toBe(false);
    await t.dismiss.execute(
      new DismissSharedTickerCommand('anna', 'DOT', false),
    );
    // A chosen coin silences it as well.
    await t.setChoice.execute(
      new SetCoinChoiceCommand('anna', 'DOT', {
        provider: 'coingecko',
        id: 'polkadot',
      }),
    );
    after = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(after.assets.find((a) => a.asset === 'DOT')).toMatchObject({
      pricing: 'chosen',
      shared: null,
    });
    // The hand-kept list cannot be dismissed — a coin must be chosen.
    await expect(
      t.dismiss.execute(new DismissSharedTickerCommand('anna', 'OPN', true)),
    ).rejects.toThrow();
  });

  it('no clear leader: nothing is fetched by ticker (like the hand-kept list)', async () => {
    const t = await setup();
    t.directory.market = [
      market('polkadot', 'DOT', 400),
      market('dot-rival', 'DOT', 700),
    ];
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, true),
    );
    expect(summary.assets.find((a) => a.asset === 'DOT')).toMatchObject({
      status: 'ambiguous',
    });
    expect(t.usd.calls.map((c) => c.symbol)).not.toContain('DOT');
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const view = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(view.assets.find((a) => a.asset === 'DOT')).toMatchObject({
      pricing: 'ambiguous',
      shared: { level: 'ambiguous', basis: 'market' },
    });
    // The calculation: no silent price (an old Binance row never counts) and the open item.
    await t.rates.upsertMany(t.project.id, [
      {
        kind: 'price',
        asset: 'DOT',
        currency: 'USD',
        date: '2025-12-31',
        value: '5',
        source: 'binance',
      },
    ]);
    // Filtered before the hash: such a row does not even make the result stale.
    const result = await t.result.execute(
      new GetResultQuery('anna', t.project.id),
    );
    expect(result.stale).toBe(false);
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const after = await t.result.execute(
      new GetResultQuery('anna', t.project.id),
    );
    expect(
      after.result?.positions
        .filter((p) => p.asset === 'DOT')
        .every((p) => p.valueChf === null),
    ).toBe(true);
    expect(after.result?.openItems.map((i) => i.key)).toContain(
      'ambiguousPrice:DOT',
    );
    // "Passt so" settles warnings only — without a clear leader a coin must be chosen.
    await t.dismiss.execute(
      new DismissSharedTickerCommand('anna', 'DOT', true),
    );
    const still = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(still.assets.find((a) => a.asset === 'DOT')?.shared?.level).toBe(
      'ambiguous',
    );
  });
});

const OPN_CONTRACT = '0xc28eb2250d1ae32c7e74cfb6d6b86afc9beb6509';

describe('wallet tokens identified by chain + contract (F6, F7.4)', () => {
  async function withWallet(t: Setup, contracts: readonly string[]) {
    const wallet = await t.wallets.create({
      ownerId: 'anna',
      label: 'MetaMask',
      address: '0x1111111111111111111111111111111111111111',
      addressKind: 'evm',
      networks: ['ethereum'],
      notes: '',
    });
    await t.wallets.addToProject(t.project.id, wallet.id);
    await t.wallets.saveData({
      walletId: wallet.id,
      network: 'ethereum',
      status: 'ok',
      errorCode: null,
      errorDetail: null,
      info: {},
      fetchedAt: '2026-01-02T00:00:00.000Z',
      movements: contracts.map((tokenId, i) => ({
        txHash: `0xtx${i}`,
        timestamp: '2025-06-01T00:00:00.000Z',
        asset: 'OPN',
        tokenId,
        tokenName: 'OPEN Ticketing Ecosystem',
        quantity: '1000',
        fee: null,
        feeAsset: null,
        type: 'transfer',
        counterparty: null,
        verified: null,
      })),
    });
  }

  it('an ambiguous ticker held under one contract is that coin — stored, priced from it, no open item', async () => {
    const t = await setup();
    t.directory.contracts.set(
      `ethereum:${OPN_CONTRACT}`,
      'open-ticketing-ecosystem',
    );
    await withWallet(t, [OPN_CONTRACT.toUpperCase().replace('0X', '0x')]);
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.contracts).toEqual([
      {
        asset: 'OPN',
        choice: {
          provider: 'coingecko',
          id: 'open-ticketing-ecosystem',
          name: 'OPEN Ticketing Ecosystem',
          symbol: 'OPN',
          contract: { network: 'ethereum', address: OPN_CONTRACT },
        },
      },
    ]);
    expect(summary.assets.find((a) => a.asset === 'OPN')).toMatchObject({
      status: 'fetched',
      source: 'coingecko',
    });
    expect(t.usd.calls.map((c) => c.symbol)).not.toContain('OPN');
    expect(
      (await t.userSettings.find('anna'))?.coinChoices['OPN']?.contract,
    ).toEqual({ network: 'ethereum', address: OPN_CONTRACT });
    const { items } = await opnPosition(t);
    expect(items.map((i) => i.reason)).not.toContain('ambiguousPrice');
  });

  it('several contracts for one ticker (a fake token) or an unlisted contract: nothing is identified', async () => {
    expect(
      walletContracts([
        {
          walletId: 'w',
          network: 'ethereum',
          status: 'ok',
          errorCode: null,
          errorDetail: null,
          info: {},
          fetchedAt: '2026-01-02T00:00:00.000Z',
          movements: [OPN_CONTRACT, `0x${'2'.repeat(40)}`].map((tokenId) => ({
            txHash: '0x1',
            timestamp: '2025-06-01T00:00:00.000Z',
            asset: 'opn',
            tokenId,
            tokenName: null,
            quantity: '1',
            fee: null,
            feeAsset: null,
            type: 'transfer' as const,
            counterparty: null,
            verified: null,
          })),
        },
      ]).has('OPN'),
    ).toBe(false);
    const t = await setup();
    await withWallet(t, [OPN_CONTRACT]);
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.contracts).toEqual([]);
    expect(t.directory.calls).toContain(`contract:ethereum:${OPN_CONTRACT}`);
    expect(summary.assets.find((a) => a.asset === 'OPN')?.status).toBe(
      'ambiguous',
    );
    expect(
      (await t.userSettings.find('anna'))?.coinChoices['OPN'],
    ).toBeUndefined();
  });
});
