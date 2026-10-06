import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  BOOKINGS_CSV,
  calculationSetup,
} from '../../calculation/testing/calculation-fixture';
import { InMemoryUserRateRepository } from '../../carryover/testing/in-memory-carryover.repositories';
import type { Env } from '../../config/env';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from '../../files/application/commands/upload-project-file.command';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import { SourceFileReader } from '../../files/application/source-file-reader';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import {
  FakeFiatSource,
  FakeFxSource,
  FakeUsdSource,
} from '../../rates/testing/in-memory-project-rate.repository';
import {
  SettingsReader,
  SettingsSecrets,
} from '../../settings/application/settings.handlers';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import { DashboardInputService } from './dashboard-input.service';
import {
  checkPeriod,
  DashboardCache,
  DashboardCalculator,
  GetDashboardHandler,
  GetDashboardQuery,
  GetDashboardRecordsHandler,
  GetDashboardRecordsQuery,
  RefreshDashboardRatesCommand,
  RefreshDashboardRatesHandler,
} from './dashboard.handlers';

async function setup(online: 'true' | 'false' = 'true') {
  const t = await calculationSetup();
  const userRates = new InMemoryUserRateRepository();
  const mappings = new InMemoryImportMappingRepository(t.files);
  const inputs = new DashboardInputService(
    t.projects,
    t.files,
    mappings,
    t.rates,
    t.corrections,
    userRates,
    t.inputs,
  );
  const readFiles = vi.spyOn(t.inputs, 'recordsOf');
  const calculator = new DashboardCalculator(inputs, new DashboardCache());
  const config = {
    get: (key: string) =>
      key === 'RATES_ONLINE'
        ? online
        : key === 'SETTINGS_ENCRYPTION_KEY'
          ? 'a-test-key-that-is-long-enough-for-aes-256-gcm'
          : undefined,
  } as unknown as ConfigService<Env, true>;
  const settings = new SettingsReader(
    new InMemoryUserSettingsRepository(),
    new SettingsSecrets(config),
  );
  const usd = new FakeUsdSource({ DOT: '5' });
  const fx = new FakeFxSource();
  return {
    ...t,
    userRates,
    readFiles,
    usd,
    fx,
    get: new GetDashboardHandler(calculator, settings, config),
    records: new GetDashboardRecordsHandler(calculator),
    refresh: new RefreshDashboardRatesHandler(
      inputs,
      userRates,
      settings,
      usd,
      new FakeFiatSource(),
      fx,
      config,
    ),
  };
}

describe('dashboard (F11.4–F11.9)', () => {
  it('values the holdings over the period across all projects, missing prices named', async () => {
    const t = await setup();
    const view = await t.get.execute(
      new GetDashboardQuery('anna', '2025-12-01', '2025-12-31'),
    );
    // 0.005 BTC × 90000 USD × 0.8 + 498.7 CHF (the statement of 31.12.)
    expect(view.endValueChf).toBe('858.7');
    expect(view.series).toHaveLength(31);
    // BTC has a price only within 14 days of 31.12. — earlier days name it, never as 0.
    expect(view.missingPrices).toEqual(['BTC', 'DOT', 'ETH']);
    expect(view.series[0]?.missing).toContain('BTC');
    expect(view.holdings.find((h) => h.asset === 'ETH')).toMatchObject({
      status: 'missingPrice',
      valueChf: null,
    });
    expect(view.projects).toEqual([
      { id: t.project.id, name: 'Steuern 2025', taxYear: 2025 },
    ]);
    expect(view.online).toBe(true);
  });

  it('reads a file shared by two projects once, and answers again from the cache', async () => {
    const t = await setup();
    const before = await t.get.execute(
      new GetDashboardQuery('anna', '2025-01-01', '2025-12-31'),
    );
    const older = await t.projects.create('anna', {
      name: 'Steuern 2024',
      taxYear: 2024,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    await new UploadProjectFileHandler(
      t.projects,
      t.files,
      new FileAnalysisService(
        new SourceFileReader(),
        new InMemoryImportMappingRepository(t.files),
      ),
    ).execute(
      new UploadProjectFileCommand(
        'anna',
        older.id,
        'buchungen.csv',
        new TextEncoder().encode(BOOKINGS_CSV),
      ),
    );
    t.readFiles.mockClear();
    const after = await t.get.execute(
      new GetDashboardQuery('anna', '2025-01-01', '2025-12-31'),
    );
    expect(after.endValueChf).toBe(before.endValueChf);
    expect(after.kpis).toEqual(before.kpis);
    expect(t.readFiles).toHaveBeenCalledTimes(2);
    t.readFiles.mockClear();
    await t.get.execute(
      new GetDashboardQuery('anna', '2025-01-01', '2025-12-31'),
    );
    expect(t.readFiles).not.toHaveBeenCalled();
  });

  it('drills a KPI down to its bookings with file and row', async () => {
    const t = await setup();
    const answer = await t.records.execute(
      new GetDashboardRecordsQuery(
        'anna',
        '2025-01-01',
        '2025-12-31',
        'deposits',
      ),
    );
    expect(answer.figureId).toBe('kpi:deposits');
    expect(answer.records).toEqual([
      expect.objectContaining({
        asset: 'CHF',
        row: 2,
        fileName: 'buchungen.csv',
        projectId: t.project.id,
      }),
    ]);
    await expect(
      t.records.execute(
        new GetDashboardRecordsQuery(
          'anna',
          '2025-01-01',
          '2025-12-31',
          'nope',
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fetches missing series into the user cache, skips covered ones, respects the off switch', async () => {
    const t = await setup();
    const summary = await t.refresh.execute(
      new RefreshDashboardRatesCommand(
        'anna',
        '2025-12-01',
        '2025-12-31',
        ['DOT', 'BTC'],
        false,
      ),
    );
    expect(summary.assets.map((a) => [a.asset, a.status])).toEqual([
      ['DOT', 'fetched'],
      ['BTC', 'notFound'],
    ]);
    expect((await t.userRates.listByUser('anna')).length).toBeGreaterThan(0);
    const view = await t.get.execute(
      new GetDashboardQuery('anna', '2025-12-01', '2025-12-31'),
    );
    // The fake source answers three days only; the Stichtag is priced now.
    expect(view.holdings.find((h) => h.asset === 'DOT')).toMatchObject({
      priceChf: '4',
      status: 'ok',
    });

    const off = await setup('false');
    await expect(
      off.refresh.execute(
        new RefreshDashboardRatesCommand(
          'anna',
          '2025-12-01',
          '2025-12-31',
          [],
          false,
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('shows one tax currency at a time — never a sum across currencies (F4.1a)', async () => {
    const t = await setup();
    const eur = await t.projects.create('anna', {
      name: 'Steuern 2024 (DE)',
      taxYear: 2024,
      country: 'CH',
      canton: 'ZH',
      taxCurrency: 'EUR',
      notes: '',
    });
    await t.rates.upsertMany(eur.id, [
      {
        kind: 'fx',
        asset: 'USD',
        currency: 'EUR',
        date: '2025-12-31',
        value: '0.85',
        source: 'ecb',
      },
    ]);
    // Default: the newest project's currency (the CHF project of 2025).
    const chf = await t.get.execute(
      new GetDashboardQuery('anna', '2025-12-01', '2025-12-31'),
    );
    expect(chf).toMatchObject({
      currency: 'CHF',
      currencies: ['CHF', 'EUR'],
      endValueChf: '858.7',
    });
    expect(chf.projects.map((p) => p.taxYear)).toEqual([2025]);
    // The EUR view holds the EUR project only (no files: nothing valued yet).
    const inEur = await t.get.execute(
      new GetDashboardQuery(
        'anna',
        '2025-12-01',
        '2025-12-31',
        undefined,
        'EUR',
      ),
    );
    expect(inEur).toMatchObject({ currency: 'EUR', endValueChf: '0' });
    expect(inEur.projects.map((p) => p.id)).toEqual([eur.id]);
    // The card of one project uses that project's currency.
    const card = await t.get.execute(
      new GetDashboardQuery('anna', '2024-01-01', '2024-12-31', eur.id),
    );
    expect(card.currency).toBe('EUR');
    // Rates for the EUR view are fetched in EUR.
    await t.refresh.execute(
      new RefreshDashboardRatesCommand(
        'anna',
        '2025-12-01',
        '2025-12-31',
        [],
        true,
        'EUR',
      ),
    );
    expect(t.fx.calls).toEqual(['USD>EUR']);
  });

  it('checks the period', () => {
    expect(() => checkPeriod('2025-02-01', '2025-01-01')).toThrow(
      BadRequestException,
    );
    expect(() => checkPeriod('2010-01-01', '2025-01-01')).toThrow(
      BadRequestException,
    );
    expect(() => checkPeriod('2025-1-1', '2025-01-01')).toThrow(
      BadRequestException,
    );
  });
});
