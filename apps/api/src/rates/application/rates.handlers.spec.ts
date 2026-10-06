import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import { CalculateProjectCommand } from '../../calculation/application/calculation.handlers';
import type { Env } from '../../config/env';
import {
  SettingsReader,
  SettingsSecrets,
} from '../../settings/application/settings.handlers';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import {
  FakeChfSource,
  FakeFxSource,
  FakeUsdSource,
} from '../testing/in-memory-project-rate.repository';
import {
  DeleteManualRateCommand,
  DeleteManualRateHandler,
  GetRatesHandler,
  GetRatesQuery,
  GetRefreshStatusHandler,
  GetRefreshStatusQuery,
  ImportKurslisteCommand,
  ImportKurslisteHandler,
  type RatesView,
  RefreshRatesCommand,
  RefreshRatesHandler,
  SetManualRateCommand,
  SetManualRateHandler,
} from './rates.handlers';
import { RefreshProgress } from './refresh-progress';

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
  const progress = new RefreshProgress();
  return {
    ...t,
    settingsRepo,
    secrets,
    usd,
    chf,
    fx,
    getRates: new GetRatesHandler(t.projects, t.rates, settings, config),
    refresh: new RefreshRatesHandler(
      t.projects,
      t.rates,
      t.inputs,
      settings,
      usd,
      chf,
      fx,
      config,
      progress,
    ),
    refreshStatus: new GetRefreshStatusHandler(t.projects, progress),
    progress,
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

  it('reports its progress while it runs (for the activity indicator), and is idle after', async () => {
    const t = await setup();
    const seen: string[] = [];
    const original = t.fx.dailyChf.bind(t.fx);
    t.fx.dailyChf = async (base, from, to) => {
      const status = await t.refreshStatus.execute(
        new GetRefreshStatusQuery('anna', t.project.id),
      );
      seen.push(`${status.done}/${status.total}:${status.current}`);
      return original(base, from, to);
    };
    await t.refresh.execute(
      new RefreshRatesCommand('anna', t.project.id, false),
    );
    expect(seen).toEqual(['0/5:USD', '1/5:EUR']);
    expect(
      await t.refreshStatus.execute(
        new GetRefreshStatusQuery('anna', t.project.id),
      ),
    ).toEqual({ running: false, done: 0, total: 0, current: null });
    await expect(
      t.refreshStatus.execute(new GetRefreshStatusQuery('bruno', t.project.id)),
    ).rejects.toThrow();
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
