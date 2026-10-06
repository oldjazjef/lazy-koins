import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import {
  CalculateProjectCommand,
  GetResultQuery,
} from '../../calculation/application/calculation.handlers';
import type { Env } from '../../config/env';
import {
  SettingsReader,
  SettingsSecrets,
} from '../../settings/application/settings.handlers';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import type { EstvVersion } from '../domain/estv';
import {
  crypto,
  fx as estvFx,
  InMemoryEstvRepository,
} from '../testing/in-memory-estv';
import {
  FakeChfSource,
  FakeFxSource,
  FakeUsdSource,
} from '../testing/in-memory-project-rate.repository';
import { ApplyEstvCommand, ApplyEstvHandler } from './estv.handlers';
import { EstvProjectRatesService } from './estv-project-rates.service';
import {
  DeleteManualRateCommand,
  DeleteManualRateHandler,
  GetRatesHandler,
  GetRatesQuery,
  ImportKurslisteCommand,
  ImportKurslisteHandler,
  type RatesView,
  RefreshRatesCommand,
  RefreshRatesHandler,
  SetManualRateCommand,
  SetManualRateHandler,
} from './rates.handlers';

async function setup(online: 'true' | 'false' = 'true') {
  const t = await calculationSetup();
  const settingsRepo = new InMemoryUserSettingsRepository();
  const config = {
    get: (key: string) =>
      key === 'RATES_ONLINE'
        ? online
        : key === 'SETTINGS_ENCRYPTION_KEY'
          ? 'a-test-key-that-is-long-enough-for-aes-256-gcm'
          : undefined,
  } as unknown as ConfigService<Env, true>;
  const secrets = new SettingsSecrets(config);
  const settings = new SettingsReader(settingsRepo, secrets);
  const usd = new FakeUsdSource({ DOT: '5', POL: '0.2' });
  const chf = new FakeChfSource();
  const fx = new FakeFxSource();
  const estvStore = new InMemoryEstvRepository();
  const estv = new EstvProjectRatesService(estvStore, t.rates, t.inputs);
  return {
    ...t,
    settingsRepo,
    secrets,
    usd,
    chf,
    fx,
    estvStore,
    getRates: new GetRatesHandler(
      t.projects,
      t.rates,
      settings,
      config,
      estvStore,
    ),
    refresh: new RefreshRatesHandler(
      t.projects,
      t.rates,
      t.inputs,
      settings,
      usd,
      chf,
      fx,
      config,
      estv,
    ),
    applyEstv: new ApplyEstvHandler(t.projects, settings, estv),
    setManual: new SetManualRateHandler(t.projects, t.rates),
    deleteManual: new DeleteManualRateHandler(t.projects, t.rates),
    kursliste: new ImportKurslisteHandler(t.projects, t.rates),
  };
}

describe('rates (F7.4)', () => {
  it('fetches FX and every asset that needs a price, serially, and caches them', async () => {
    const t = await setup();
    await t.settingsRepo.save('anna', {
      sealedKeys: { coingecko: t.secrets.box.seal('cg-key') },
    });
    // BTC already has a series covering the year (both ends): cached.
    await t.rates.upsertMany(t.project.id, [
      {
        kind: 'price',
        asset: 'BTC',
        currency: 'USD',
        date: '2025-01-02',
        value: '80000',
        source: 'binance',
      },
    ]);
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(t.fx.calls).toEqual(['USD', 'EUR']);
    // BTC is already stored for the year (cache); DOT from Binance; ETH via CoinGecko.
    expect(summary.assets).toEqual([
      { asset: 'BTC', status: 'cached', source: null, points: 0 },
      { asset: 'DOT', status: 'fetched', source: 'binance', points: 3 },
      { asset: 'ETH', status: 'fetched', source: 'coingecko', points: 3 },
    ]);
    expect(t.usd.calls[0]).toMatchObject({
      asset: 'DOT',
      symbol: 'DOT',
      from: '2024-12-01',
      to: '2026-01-15',
    });
    expect(t.chf.calls[0]).toMatchObject({
      coinId: 'ethereum',
      apiKey: 'cg-key',
    });

    const view = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(view.online).toBe(true);
    expect(
      view.series.find((s) => s.asset === 'DOT' && s.kind === 'price'),
    ).toMatchObject({ points: 3, yearEnd: { date: '2025-12-31', value: '5' } });

    const result = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(
      result.result?.positions.find((p) => p.asset === 'DOT'),
    ).toMatchObject({
      valueChf: '6',
      priceOrigin: 'tableUsd',
    });

    // A second refresh fetches nothing again.
    const again = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(again.assets.map((a) => a.status)).toEqual([
      'cached',
      'cached',
      'cached',
    ]);
  });

  it('is refused when rate lookups are off (F11.3)', async () => {
    const t = await setup();
    await t.settingsRepo.save('anna', { onlineRates: false });
    await expect(
      t.refresh.execute(new RefreshRatesCommand('anna', t.project.id, false)),
    ).rejects.toBeInstanceOf(ConflictException);
    const off = await setup('false');
    await expect(
      off.refresh.execute(
        new RefreshRatesCommand('anna', off.project.id, false),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('overrides a rate for a day and removes the override again', async () => {
    const t = await setup();
    await t.setManual.execute(
      new SetManualRateCommand('anna', t.project.id, {
        kind: 'fx',
        asset: 'usd',
        currency: 'CHF',
        date: '2025-12-31',
        value: '0.7900',
      }),
    );
    const view = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(view.manual).toEqual([
      expect.objectContaining({
        asset: 'USD',
        value: '0.79',
        source: 'manual',
      }),
    ]);
    const result = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(result.result?.parameters.usdChf).toBe('0.79');
    await t.deleteManual.execute(
      new DeleteManualRateCommand('anna', t.project.id, {
        kind: 'fx',
        asset: 'USD',
        currency: 'CHF',
        date: '2025-12-31',
        source: 'manual',
      }),
    );
    expect(
      (
        (await t.getRates.execute(
          new GetRatesQuery('anna', t.project.id),
        )) as RatesView
      ).manual,
    ).toEqual([]);
    await expect(
      t.setManual.execute(
        new SetManualRateCommand('anna', t.project.id, {
          kind: 'price',
          asset: 'BTC',
          currency: 'CHF',
          date: '2025-12-31',
          value: '0',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('imports the ESTV Kursliste as estv rates that win over fetched prices', async () => {
    const t = await setup();
    const imported = await t.kursliste.execute(
      new ImportKurslisteCommand(
        'anna',
        t.project.id,
        'asset;kurs_chf;datum\nBTC;70000;31.12.2025\n',
      ),
    );
    expect(imported).toEqual({ imported: 1, skipped: 0 });
    const result = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(
      result.result?.positions.find((p) => p.asset === 'BTC'),
    ).toMatchObject({
      priceOrigin: 'estv',
      valueChf: '350',
    });
    await expect(
      t.kursliste.execute(
        new ImportKurslisteCommand('anna', t.project.id, 'nothing'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

const version = (exportDate: string, fileHash: string): EstvVersion => ({
  year: 2025,
  exportType: 'THIRD.INIT.220',
  exportDate,
  fileHash,
  fileName: 'kursliste_2025.zip',
  schemaVersion: '2.2.0',
  downloadedAt: exportDate,
  entryCount: 4,
  cryptoCount: 3,
});

describe('automatic ESTV Kursliste in a project (F7.4a)', () => {
  it('applies the stored list on refresh: matched cryptos and USD/EUR win, labelled with the version', async () => {
    const t = await setup();
    await t.estvStore.replaceYear(version('2026-03-02T08:00:00.000Z', 'h1'), [
      crypto('BTC', 'Bitcoin', '70000', '39714275'),
      crypto('ETH', 'Ethereum', '2400', '41623437'),
      // Two different entries with the ticker DOT, neither named like the known coin
      // ("polkadot"): ambiguous, no value.
      crypto('DOT', 'Wrapped Dot', '4', '111'),
      crypto('DOT', 'Dotcoin', '0.01', '222'),
      estvFx('USD', '0.79'),
      estvFx('EUR', '0.93'),
    ]);
    const summary = await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(summary.estv).toMatchObject({
      year: 2025,
      label: 'ESTV-Kursliste 2025, Stand 02.03.2026',
      matched: [
        { asset: 'BTC', symbol: 'BTC', name: 'Bitcoin', value: '70000' },
        { asset: 'ETH', symbol: 'ETH', name: 'Ethereum', value: '2400' },
      ],
      ambiguous: [
        {
          asset: 'DOT',
          candidates: [
            { name: 'Dotcoin', valorNumber: '222' },
            { name: 'Wrapped Dot', valorNumber: '111' },
          ],
        },
      ],
      fx: ['USD', 'EUR'],
    });
    const view = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(view.estv).toEqual({
      autoEnabled: true,
      available: 'ESTV-Kursliste 2025, Stand 02.03.2026',
      cryptoCount: 3,
      applied: 'ESTV-Kursliste 2025, Stand 02.03.2026',
      outdated: false,
    });
    expect(view.manual.find((r) => r.asset === 'BTC')).toMatchObject({
      source: 'estv',
      date: '2025-12-31',
      value: '70000',
      note: 'ESTV-Kursliste 2025, Stand 02.03.2026',
    });
    const first = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(
      first.result?.positions.find((p) => p.asset === 'BTC'),
    ).toMatchObject({ priceOrigin: 'estv', valueChf: '350' });
    // ESTV year-end USD/CHF wins over the ECB fixing of the same day.
    expect(first.result?.parameters.usdChf).toBe('0.79');

    // A newer version: the project shows it as outdated, applying changes the values.
    await t.estvStore.replaceYear(version('2026-05-04T08:00:00.000Z', 'h2'), [
      crypto('BTC', 'Bitcoin', '71000', '39714275'),
      estvFx('USD', '0.79'),
    ]);
    const outdated = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(outdated.estv).toMatchObject({
      available: 'ESTV-Kursliste 2025, Stand 04.05.2026',
      applied: 'ESTV-Kursliste 2025, Stand 02.03.2026',
      outdated: true,
    });
    const applied = await t.applyEstv.execute(
      new ApplyEstvCommand('anna', t.project.id),
    );
    expect(applied.matched.map((m) => m.asset)).toEqual(['BTC']);
    const rows = await t.rates.listByProject(t.project.id);
    const estvRows = rows.filter((r) => r.source === 'estv');
    // ETH and EUR are no longer in the list: their automatic rows are gone.
    expect(estvRows.map((r) => `${r.kind}:${r.asset}:${r.value}`)).toEqual([
      'fx:USD:0.79',
      'price:BTC:71000',
    ]);
    expect(new Set(estvRows.map((r) => r.note))).toEqual(
      new Set(['ESTV-Kursliste 2025, Stand 04.05.2026']),
    );
    const result = await t.result.execute(
      new GetResultQuery('anna', t.project.id),
    );
    expect(result.stale).toBe(true);
  });

  it('applies without the internet and does nothing when no list is stored', async () => {
    const t = await setup('false');
    const none = await t.applyEstv.execute(
      new ApplyEstvCommand('anna', t.project.id),
    );
    expect(none).toEqual({
      year: 2025,
      label: null,
      matched: [],
      ambiguous: [],
      fx: [],
    });
    await t.estvStore.replaceYear(version('2026-03-02T08:00:00.000Z', 'h1'), [
      crypto('BTC', 'Bitcoin', '70000'),
    ]);
    const applied = await t.applyEstv.execute(
      new ApplyEstvCommand('anna', t.project.id),
    );
    expect(applied.matched).toHaveLength(1);
    const view = (await t.getRates.execute(
      new GetRatesQuery('anna', t.project.id),
    )) as RatesView;
    expect(view.estv.autoEnabled).toBe(false);
  });
});
