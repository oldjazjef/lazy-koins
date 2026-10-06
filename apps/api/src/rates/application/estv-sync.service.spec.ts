import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import {
  SettingsReader,
  SettingsSecrets,
} from '../../settings/application/settings.handlers';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import type { UserRepositoryPort } from '../../users/ports/user.repository.port';
import type { EstvExport } from '../domain/estv';
import { EstvSourceError } from '../ports/estv.port';
import {
  crypto,
  FakeEstvSource,
  fx,
  InMemoryEstvRepository,
} from '../testing/in-memory-estv';
import {
  GetEstvStatusHandler,
  GetEstvStatusQuery,
  StartEstvUpdateCommand,
  StartEstvUpdateHandler,
} from './estv.handlers';
import { EstvScheduler, EstvSyncService } from './estv-sync.service';

const file = (fileHash: string, exportDate: string): EstvExport => ({
  exportType: 'THIRD.INIT.220',
  exportDate,
  fileId: '7',
  fileHash,
  fileName: 'kursliste_2025.zip',
  fileSize: 1000,
});

function setup(env: Partial<Record<keyof Env, string>> = {}) {
  const config = {
    get: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
  const source = new FakeEstvSource();
  const store = new InMemoryEstvRepository();
  const sync = new EstvSyncService(source, store, config);
  sync.now = () => new Date('2026-04-10T06:00:00Z');
  const settingsRepo = new InMemoryUserSettingsRepository();
  const settings = new SettingsReader(
    settingsRepo,
    new SettingsSecrets(config),
  );
  source.exports.set(2025, [
    file('h1', '2026-03-02T08:00:00.000Z'),
    {
      ...file('d1', '2026-03-03T08:00:00.000Z'),
      exportType: 'THIRD.DELTA.220',
    },
  ]);
  source.lists.set('h1', {
    year: 2025,
    schemaVersion: '2.2.0',
    rates: [crypto('BTC', 'Bitcoin', '70000'), fx('USD', '0.79')],
  });
  return { config, source, store, sync, settingsRepo, settings };
}

describe('ESTV Kursliste sync (F7.4a)', () => {
  it('downloads a year once and only again when a newer export exists', async () => {
    const t = setup();
    expect(await t.sync.run([2025])).toEqual([
      { year: 2025, outcome: 'updated', error: null },
    ]);
    expect(await t.store.findVersion(2025)).toMatchObject({
      exportType: 'THIRD.INIT.220',
      fileHash: 'h1',
      schemaVersion: '2.2.0',
      entryCount: 2,
      cryptoCount: 1,
    });
    // Same export again: metadata only.
    expect(await t.sync.run([2025])).toEqual([
      { year: 2025, outcome: 'current', error: null },
    ]);
    expect(t.source.calls).toEqual(['list 2025', 'fetch 2025 h1', 'list 2025']);
    // The ESTV republishes: the newer file replaces the stored version and its values.
    t.source.exports.set(2025, [file('h2', '2026-05-01T08:00:00.000Z')]);
    t.source.lists.set('h2', {
      year: 2025,
      schemaVersion: '2.2.0',
      rates: [crypto('BTC', 'Bitcoin', '71000')],
    });
    await t.sync.run([2025]);
    expect((await t.store.findVersion(2025))?.fileHash).toBe('h2');
    expect(await t.store.listRates(2025)).toEqual([
      crypto('BTC', 'Bitcoin', '71000'),
    ]);
  });

  it('stores failures as the check and shows them in the status', async () => {
    const t = setup();
    t.source.failWith = new EstvSourceError(
      'network',
      'ICTax: nicht erreichbar',
    );
    expect(await t.sync.run([2025, 2024])).toEqual([
      { year: 2025, outcome: 'failed', error: 'ICTax: nicht erreichbar' },
      { year: 2024, outcome: 'failed', error: 'ICTax: nicht erreichbar' },
    ]);
    t.source.failWith = undefined;
    const missing = await t.sync.run([2024]);
    expect(missing[0]?.error).toBe(
      'Für 2024 gibt es noch keine ESTV-Kursliste',
    );
    await t.sync.run([2025]);
    const status = await t.sync.status();
    expect(status).toMatchObject({
      autoEnabled: true,
      running: null,
      lastCheckAt: '2026-04-10T06:00:00.000Z',
      years: [
        {
          year: 2025,
          version: {
            label: 'ESTV-Kursliste 2025, Stand 02.03.2026',
            cryptoCount: 1,
            fxCount: 1,
          },
          check: { outcome: 'updated', error: null },
        },
        {
          year: 2024,
          version: null,
          check: { outcome: 'failed' },
        },
      ],
    });
  });

  it('runs one download at a time and reports progress while running', async () => {
    const t = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = t.source.fetchKursliste.bind(t.source);
    t.source.fetchKursliste = async (year, f, onProgress) => {
      onProgress?.({ phase: 'parse', bytes: 5, totalBytes: 10, entries: 1 });
      await gate;
      return original(year, f, onProgress);
    };
    const first = t.sync.run([2025]);
    const joined = t.sync.run([2025]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await t.sync.status()).running).toMatchObject({
      year: 2025,
      progress: { phase: 'parse', bytes: 5, totalBytes: 10, entries: 1 },
    });
    expect(t.sync.isRunning()).toBe(true);
    release();
    expect(await joined).toBe(await first);
    expect(t.source.calls.filter((c) => c.startsWith('fetch'))).toHaveLength(1);
    expect(t.sync.isRunning()).toBe(false);
  });

  it('checks every stored year plus last year', async () => {
    const t = setup();
    await t.store.replaceYear(
      {
        year: 2023,
        exportType: 'THIRD.INIT.220',
        exportDate: '2024-03-01T00:00:00.000Z',
        fileHash: 'x',
        fileName: 'k.zip',
        schemaVersion: '2.2.0',
        downloadedAt: '2024-03-01T00:00:00.000Z',
        entryCount: 0,
        cryptoCount: 0,
      },
      [],
    );
    expect(await t.sync.yearsToCheck()).toEqual([2025, 2023]);
  });

  it('is gated by ESTV_AUTO, RATES_ONLINE and the user switch (F11.3)', async () => {
    const off = setup({ ESTV_AUTO: 'false' });
    const start = (t: ReturnType<typeof setup>) =>
      new StartEstvUpdateHandler(t.sync, t.settings, t.config).execute(
        new StartEstvUpdateCommand('anna', 2025),
      );
    await expect(start(off)).rejects.toBeInstanceOf(ConflictException);
    await expect(
      start(setup({ RATES_ONLINE: 'false' })),
    ).rejects.toBeInstanceOf(ConflictException);
    const user = setup();
    await user.settingsRepo.save('anna', { onlineRates: false });
    await expect(start(user)).rejects.toBeInstanceOf(ConflictException);
    expect(user.source.calls).toEqual([]);

    const on = setup();
    const status = await start(on);
    expect(status.online).toBe(true);
    await on.sync.run([2025]);
    const view = await new GetEstvStatusHandler(
      on.sync,
      on.settings,
      on.config,
    ).execute(new GetEstvStatusQuery('anna'));
    expect(view.years[0]?.version?.fileHash).toBe('h1');
    await expect(
      new StartEstvUpdateHandler(on.sync, on.settings, on.config).execute(
        new StartEstvUpdateCommand('anna', 2030),
      ),
    ).rejects.toThrow(/year/);
  });

  it('the daily tick respects the desktop user switch and never runs when disabled', async () => {
    const desktop = setup({ AUTH_MODE: 'local' });
    const users = {
      findPrincipalByIdentityUid: async () => ({ id: 'local-user' }),
    } as unknown as UserRepositoryPort;
    await desktop.settingsRepo.save('local-user', { onlineRates: false });
    await new EstvScheduler(
      desktop.sync,
      users,
      desktop.settings,
      desktop.config,
    ).tick();
    expect(desktop.source.calls).toEqual([]);
    await desktop.settingsRepo.save('local-user', { onlineRates: true });
    await new EstvScheduler(
      desktop.sync,
      users,
      desktop.settings,
      desktop.config,
    ).tick();
    expect(desktop.source.calls).toEqual(['list 2025', 'fetch 2025 h1']);

    const disabled = setup({ ESTV_AUTO: 'false' });
    const scheduler = new EstvScheduler(
      disabled.sync,
      users,
      disabled.settings,
      disabled.config,
    );
    scheduler.onApplicationBootstrap();
    await scheduler.tick();
    scheduler.onModuleDestroy();
    expect(disabled.source.calls).toEqual([]);
  });
});
