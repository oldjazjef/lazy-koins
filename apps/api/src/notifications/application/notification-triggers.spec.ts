import { FakePriceHistorySources } from '../../rates/testing/fake-price-history';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadGatewayException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { validateMappingSpec } from '@lazykoins/engine';
import { AiGate, AiRuntime } from '../../ai/application/ai-gate';
import { InMemoryAiSettingsRepository } from '../../ai/testing/in-memory-ai-settings.repository';
import {
  CalculateProjectCommand,
  CalculateProjectHandler,
  UpdateOpenItemCommand,
  UpdateOpenItemHandler,
} from '../../calculation/application/calculation.handlers';
import type { CalculationService } from '../../calculation/calculation.service';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import { SecretBox } from '../../common/crypto/secret-box';
import type { Env } from '../../config/env';
import {
  CreateExportCommand,
  CreateExportHandler,
  ExportDataService,
} from '../../exports/application/exports.handlers';
import { PdfRendererPort } from '../../exports/ports/project-export.repository.port';
import { InMemoryProjectExportRepository } from '../../exports/testing/in-memory-project-export.repository';
import {
  ChangeProjectFileCommand,
  ChangeProjectFileHandler,
} from '../../files/application/commands/change-project-file.command';
import {
  RemoveProjectFileCommand,
  RemoveProjectFileHandler,
} from '../../files/application/commands/remove-project-file.command';
import {
  SetFileActiveCommand,
  SetFileActiveHandler,
} from '../../files/application/commands/set-file-active.command';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from '../../files/application/commands/upload-project-file.command';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import {
  UpdateHintStateCommand,
  UpdateHintStateHandler,
} from '../../files/application/queries/project-hints.query';
import { SourceFileReader } from '../../files/application/source-file-reader';
import { InMemoryHintStateRepository } from '../../files/testing/in-memory-hint-state.repository';
import { AiProviderError } from '../../integrations/ai/ai-completion.port';
import { MailGate, MailRuntime } from '../../mail/application/mail-gate';
import {
  SaveMailSettingsCommand,
  SaveMailSettingsHandler,
} from '../../mail/application/mail-settings.handlers';
import {
  SendMailCommand,
  SendMailHandler,
} from '../../mail/application/send-mail.handlers';
import {
  FakeMailTransport,
  InMemoryMailLogRepository,
  InMemoryMailSettingsRepository,
} from '../../mail/testing/mail-doubles';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import {
  ImportProjectPackageCommand,
  ImportProjectPackageHandler,
} from '../../packages/application/packages.handlers';
import type { ProjectPackageService } from '../../packages/application/project-package.service';
import { PackageError } from '../../packages/domain/package-format';
import {
  UndoProjectSentCommand,
  UndoProjectSentHandler,
} from '../../projects/application/sent.handlers';
import { NO_CHANGES } from '../../projects/domain/project-sent';
import { InMemoryProjectSentRepository } from '../../projects/testing/in-memory-project-sent.repository';
import { EstvNotifier } from '../../rates/application/estv-notifier';
import { EstvProjectRatesService } from '../../rates/application/estv-project-rates.service';
import { EstvSyncService } from '../../rates/application/estv-sync.service';
import {
  RefreshRatesCommand,
  RefreshRatesHandler,
} from '../../rates/application/rates.handlers';
import { RefreshProgress } from '../../rates/application/refresh-progress';
import { EstvSourceError } from '../../rates/ports/estv.port';
import {
  crypto,
  FakeEstvSource,
  fx,
  InMemoryEstvRepository,
} from '../../rates/testing/in-memory-estv';
import {
  FakeFxSource,
  FakeUsdSource,
} from '../../rates/testing/in-memory-project-rate.repository';
import {
  SettingsReader,
  SettingsSecrets,
} from '../../settings/application/settings.handlers';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import type { UserRepositoryPort } from '../../users/ports/user.repository.port';
import { Topics } from '../domain/notification';
import { InMemoryNotificationRepository } from '../testing/in-memory-notification.repository';
import { NotificationService } from './notification.service';
import { ProjectNotifications } from './project-notifications.service';

/** The engine's synthetic fixtures — never real data (CLAUDE.md, Private data). */
const ENGINE = resolve(__dirname, '../../../../../libs/engine/src');
const fixture = (path: string) =>
  new Uint8Array(readFileSync(resolve(ENGINE, path)));
const KRAKEN = 'mapping/fixtures/kraken-ledger-2024.csv';
const BITFINEX = 'mapping/fixtures/bitfinex-ledger.csv';

const config = {
  get: (key: string) =>
    key === 'RATES_ONLINE'
      ? 'true'
      : key === 'SETTINGS_ENCRYPTION_KEY'
        ? 'a-test-key-that-is-long-enough-for-aes-256-gcm'
        : undefined,
} as unknown as ConfigService<Env, true>;

const users = {
  findById: async (id: string) =>
    id === 'anna'
      ? { id, email: 'anna@lazykoins.dev', displayName: 'Anna' }
      : undefined,
} as unknown as UserRepositoryPort;

/** The calculation fixture plus the notification centre and every notifying handler. */
async function setup() {
  const t = await calculationSetup();
  const repository = new InMemoryNotificationRepository();
  repository.projectNames.set(t.project.id, t.project.name);
  const notifications = new NotificationService(repository);
  const hintStates = new InMemoryHintStateRepository();
  const sent = new InMemoryProjectSentRepository();
  const projectNotifications = new ProjectNotifications(
    notifications,
    t.projects,
    t.files,
    hintStates,
    t.snapshots,
    t.states,
    sent,
  );
  const mappings = new InMemoryImportMappingRepository(t.files);
  const analysis = new FileAnalysisService(new SourceFileReader(), mappings);
  return {
    ...t,
    repository,
    notifications,
    projectNotifications,
    hintStates,
    sent,
    mappings,
    upload: new UploadProjectFileHandler(
      t.projects,
      t.files,
      analysis,
      notifications,
      projectNotifications,
    ),
    change: new ChangeProjectFileHandler(
      t.projects,
      t.files,
      mappings,
      analysis,
      projectNotifications,
    ),
    remove: new RemoveProjectFileHandler(
      t.projects,
      t.files,
      projectNotifications,
    ),
    updateHint: new UpdateHintStateHandler(
      t.projects,
      hintStates,
      projectNotifications,
    ),
    calculateNotified: new CalculateProjectHandler(
      t.projects,
      t.inputs,
      t.snapshots,
      projectNotifications,
    ),
    tickNotified: new UpdateOpenItemHandler(
      t.projects,
      t.states,
      projectNotifications,
    ),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const open = (t: Setup, topic: string) => {
  const row = t.repository.topic(topic);
  return row && row.resolvedAt === null ? row : undefined;
};

describe('notification triggers (F11.12)', () => {
  it('a file without mapping asks for one and resolves itself once mapped', async () => {
    const t = await setup();
    const file = await t.upload.execute(
      new UploadProjectFileCommand(
        'anna',
        t.project.id,
        'ledger.csv',
        fixture(KRAKEN),
      ),
    );
    expect(file.status).toBe('needs_mapping');
    const topic = Topics.fileNeedsMapping(file.id);
    expect(open(t, topic)).toMatchObject({
      kind: 'action',
      projectId: t.project.id,
      projectName: 'Steuern 2025',
      titleKey: 'notifications.title.file.needsMapping',
      params: { name: 'ledger.csv' },
      action: {
        labelKey: 'notifications.action.toFile',
        route: `/app/projects/${t.project.id}`,
        query: { tab: 'files' },
        fragment: `file-${file.id}`,
      },
    });

    const validated = validateMappingSpec(
      JSON.parse(
        readFileSync(
          resolve(ENGINE, 'mapping/fixtures/kraken-ledger.mapping.json'),
          'utf8',
        ),
      ),
    );
    if (!validated.ok) throw new Error('fixture mapping is invalid');
    const mapping = await t.mappings.create('anna', {
      spec: validated.spec,
      origin: 'manual',
    });
    await t.change.execute(
      new ChangeProjectFileCommand('anna', t.project.id, file.id, {
        mode: 'mapping',
        mappingId: mapping.id,
      }),
    );
    expect(open(t, topic)).toBeUndefined();
    expect(t.repository.topic(topic)?.resolvedAt).not.toBeNull();
  });

  it('a hint marked done or a removed file settles its notification', async () => {
    const t = await setup();
    const first = await t.upload.execute(
      new UploadProjectFileCommand(
        'anna',
        t.project.id,
        'a.csv',
        fixture(KRAKEN),
      ),
    );
    const second = await t.upload.execute(
      new UploadProjectFileCommand(
        'anna',
        t.project.id,
        'b.csv',
        fixture(BITFINEX),
      ),
    );
    expect(open(t, Topics.fileNeedsMapping(first.id))).toBeDefined();
    expect(open(t, Topics.fileNeedsMapping(second.id))).toBeDefined();

    await t.updateHint.execute(
      new UpdateHintStateCommand(
        'anna',
        t.project.id,
        `unrecognisedFile:${first.id}`,
        'ignored',
        '',
      ),
    );
    expect(open(t, Topics.fileNeedsMapping(first.id))).toBeUndefined();
    await t.updateHint.execute(
      new UpdateHintStateCommand(
        'anna',
        t.project.id,
        `unrecognisedFile:${first.id}`,
        'open',
        '',
      ),
    );
    expect(open(t, Topics.fileNeedsMapping(first.id))).toBeDefined();

    await t.remove.execute(
      new RemoveProjectFileCommand('anna', t.project.id, second.id),
    );
    expect(open(t, Topics.fileNeedsMapping(second.id))).toBeUndefined();
  });

  it('a deactivated file nags no more; activated again, it does (F5.7a)', async () => {
    const t = await setup();
    const toggle = new SetFileActiveHandler(
      t.projects,
      t.files,
      t.projectNotifications,
    );
    const file = await t.upload.execute(
      new UploadProjectFileCommand(
        'anna',
        t.project.id,
        'a.csv',
        fixture(KRAKEN),
      ),
    );
    const topic = Topics.fileNeedsMapping(file.id);
    expect(open(t, topic)).toBeDefined();
    await toggle.execute(
      new SetFileActiveCommand('anna', t.project.id, file.id, false),
    );
    expect(open(t, topic)).toBeUndefined();
    await toggle.execute(
      new SetFileActiveCommand('anna', t.project.id, file.id, true),
    );
    expect(open(t, topic)).toBeDefined();
  });

  it('a calculation raises open items and missing prices; ticking the last one resolves it', async () => {
    const t = await setup();
    await t.calculateNotified.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const snapshot = await t.snapshots.latest(t.project.id);
    const items = snapshot?.result.openItems ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(open(t, Topics.openItems(t.project.id))).toMatchObject({
      kind: 'action',
      params: { count: items.length },
      action: { query: { tab: 'checks' } },
    });
    expect(snapshot?.result.totals.missingPrices).toBeGreaterThan(0);
    expect(open(t, Topics.missingPrices(t.project.id))).toMatchObject({
      params: { count: snapshot?.result.totals.missingPrices },
      action: { query: { tab: 'rates' } },
    });

    for (const item of items) {
      await t.tickNotified.execute(
        new UpdateOpenItemCommand('anna', t.project.id, item.key, {
          done: true,
        }),
      );
    }
    expect(open(t, Topics.openItems(t.project.id))).toBeUndefined();
  });

  it('data changed since sending to the Treuhänder (F4.7) is raised and resolved', async () => {
    const t = await setup();
    await t.sent.save(t.project.id, {
      sentAt: '2026-01-10T10:00:00.000Z',
      sentTo: 'treuhand@example.ch',
      via: 'mail',
      note: '',
      exportIds: [],
      mailLogId: null,
      snapshotHash: null,
    });
    t.sent.facts.set(t.project.id, {
      ...NO_CHANGES,
      lastFileAddedAt: '2026-02-01T10:00:00.000Z',
    });
    await t.calculateNotified.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(open(t, Topics.changedSinceSent(t.project.id))).toMatchObject({
      params: { reasons: 'file' },
      action: { query: { tab: 'exports' } },
    });
    await new UndoProjectSentHandler(
      t.projects,
      t.sent,
      t.projectNotifications,
    ).execute(new UndoProjectSentCommand('anna', t.project.id));
    expect(open(t, Topics.changedSinceSent(t.project.id))).toBeUndefined();
  });

  it('rate lookups: failed assets, a refused CoinGecko key, and the clean refresh that settles both', async () => {
    const t = await setup();
    const settingsRepo = new InMemoryUserSettingsRepository();
    const secrets = new SettingsSecrets(config);
    await settingsRepo.save('anna', {
      sealedKeys: { coingecko: secrets.box.seal('cg-key') },
    });
    const usd = new FakeUsdSource({ DOT: '5' });
    const chf = new FakePriceHistorySources();
    const store = new InMemoryEstvRepository();
    const refresh = new RefreshRatesHandler(
      t.projects,
      t.rates,
      t.inputs,
      new SettingsReader(settingsRepo, secrets),
      usd,
      chf,
      new FakeFxSource(),
      config,
      new RefreshProgress(),
      new EstvProjectRatesService(store, t.rates, t.inputs),
      t.notifications,
    );
    const topic = Topics.ratesFetchFailed(t.project.id);

    // Binance fails for DOT and CoinGecko (the fallback) is unreachable: nobody priced it.
    usd.failFor.add('DOT');
    chf.fake('coingecko').failWith = { code: 'network', status: null };
    await refresh.execute(new RefreshRatesCommand('anna', t.project.id, true));
    expect(open(t, topic)).toMatchObject({
      kind: 'error',
      params: { count: 3, provider: 'coingecko', priceError: 'network' },
      action: { named: 'retry:rates', query: { tab: 'rates' } },
    });
    expect(open(t, Topics.keyInvalid('coingecko'))).toBeUndefined();

    // Binance works again (DOT priced), CoinGecko refuses the key (BTC, ETH fail).
    usd.failFor.clear();
    chf.fake('coingecko').failWith = { code: 'invalidKey', status: 401 };
    await refresh.execute(new RefreshRatesCommand('anna', t.project.id, true));
    expect(open(t, topic)?.params).toMatchObject({
      count: 2,
      priceError: 'invalidKey',
    });
    expect(open(t, Topics.keyInvalid('coingecko'))).toMatchObject({
      kind: 'action',
      action: {
        labelKey: 'notifications.action.checkKey',
        route: '/app/settings/rates',
      },
    });
    expect(JSON.stringify(t.repository.all())).not.toContain('cg-key');

    chf.fake('coingecko').failWith = undefined;
    await refresh.execute(new RefreshRatesCommand('anna', t.project.id, true));
    expect(open(t, topic)).toBeUndefined();
    expect(open(t, Topics.keyInvalid('coingecko'))).toBeUndefined();
  });

  it('ESTV: a failed check (scheduler or manual) and a new version reach the concerned users', async () => {
    const t = await setup();
    const source = new FakeEstvSource();
    const store = new InMemoryEstvRepository();
    const notifier = new EstvNotifier(t.notifications, t.projects);
    const sync = new EstvSyncService(
      source,
      store,
      { get: () => undefined } as unknown as ConfigService<Env, true>,
      notifier,
    );
    source.failWith = new EstvSourceError('network', 'ICTax nicht erreichbar');
    await sync.run([2025]);
    expect(
      open(t, Topics.estvFetchFailed(2025)) &&
        t.repository.topic(Topics.estvFetchFailed(2025), 'anna'),
    ).toMatchObject({
      kind: 'error',
      params: { year: 2025, reason: 'network' },
      action: { named: 'retry:estv' },
    });
    // A manual run also tells whoever started it, project or not.
    await sync.run([2025], 'bert');
    expect(
      t.repository.topic(Topics.estvFetchFailed(2025), 'bert'),
    ).toBeDefined();

    source.failWith = undefined;
    source.exports.set(2025, [
      {
        exportType: 'THIRD.INIT.220',
        exportDate: '2026-03-02T08:00:00.000Z',
        fileId: '7',
        fileHash: 'h1',
        fileName: 'kursliste_2025.zip',
        fileSize: 1000,
      },
    ]);
    source.lists.set('h1', {
      year: 2025,
      schemaVersion: '2.2.0',
      rates: [crypto('BTC', 'Bitcoin', '70000'), fx('USD', '0.79')],
    });
    await sync.run([2025]);
    expect(
      t.repository.topic(Topics.estvFetchFailed(2025), 'anna')?.resolvedAt,
    ).not.toBeNull();
    const fresh = open(t, Topics.estvNewVersion(t.project.id));
    expect(fresh).toMatchObject({
      kind: 'info',
      projectId: t.project.id,
      params: { year: 2025, label: 'ESTV-Kursliste 2025, Stand 02.03.2026' },
    });

    await new EstvProjectRatesService(store, t.rates, t.inputs, notifier).apply(
      t.project,
    );
    expect(open(t, Topics.estvNewVersion(t.project.id))).toBeUndefined();
  });

  it('an AI call that fails (401) raises the error and "Schlüssel prüfen"; a success settles both', async () => {
    const t = await setup();
    const gate = new AiGate(
      new InMemoryAiSettingsRepository(),
      new AiRuntime(new SecretBox('unit-test-settings-key'), true),
      t.notifications,
    );
    await expect(
      gate.call(
        () =>
          Promise.reject(
            new AiProviderError('invalidKey', {
              status: 401,
              providerMessage: 'Incorrect API key provided: sk-test-abcdefgh',
            }),
          ),
        { kind: 'openai_compatible', baseUrl: '', model: 'm', apiKey: 'sk-x' },
        { userId: 'anna' },
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(open(t, Topics.aiCallFailed())).toMatchObject({
      kind: 'error',
      params: { code: 'invalidKey', status: 401 },
    });
    expect(open(t, Topics.keyInvalid('ai'))).toBeDefined();
    expect(JSON.stringify(t.repository.all())).not.toContain('sk-test');

    await gate.call(() => Promise.resolve('ok'), undefined, {
      userId: 'anna',
    });
    expect(open(t, Topics.aiCallFailed())).toBeUndefined();
    expect(open(t, Topics.keyInvalid('ai'))).toBeUndefined();
  });

  it('mail: a failed send (auth) and a successful one', async () => {
    const t = await setup();
    const runtime = new MailRuntime(
      new SecretBox('test-encryption-key'),
      false,
    );
    const mailSettings = new InMemoryMailSettingsRepository();
    const transport = new FakeMailTransport();
    const gate = new MailGate(mailSettings, runtime, transport);
    await new SaveMailSettingsHandler(
      mailSettings,
      gate,
      runtime,
      users,
    ).execute(
      new SaveMailSettingsCommand('anna', {
        enabled: true,
        host: 'smtp.example.ch',
        port: 587,
        security: 'starttls',
        username: 'anna@example.ch',
        password: 'Sm7p-Passw0rd',
        fromName: 'Anna',
        fromAddress: 'anna@example.ch',
      }),
    );
    const send = new SendMailHandler(
      t.projects,
      new InMemoryProjectExportRepository(),
      users,
      gate,
      new InMemoryMailLogRepository(),
      t.sent,
      t.notifications,
      t.projectNotifications,
    );
    const input = {
      to: 'treuhand@example.ch',
      ccMe: false,
      subject: 'Steuern 2025',
      body: 'Guten Tag',
      exportIds: [],
      confirmed: true,
    };
    transport.failWith = {
      kind: 'auth',
      host: 'smtp.example.ch',
      port: 587,
      smtpCode: 535,
      response: '535 5.7.8 Authentication failed',
      command: 'AUTH PLAIN',
      code: 'EAUTH',
    };
    await expect(
      send.execute(new SendMailCommand('anna', t.project.id, input)),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(open(t, Topics.mailSendFailed(t.project.id))).toMatchObject({
      kind: 'error',
      params: { reason: 'auth' },
    });
    expect(open(t, Topics.keyInvalid('mail'))).toMatchObject({
      action: { route: '/app/settings/mail' },
    });
    expect(JSON.stringify(t.repository.all())).not.toContain('Passw0rd');

    transport.failWith = null;
    await send.execute(new SendMailCommand('anna', t.project.id, input));
    expect(open(t, Topics.mailSendFailed(t.project.id))).toBeUndefined();
    expect(open(t, Topics.keyInvalid('mail'))).toBeUndefined();
    expect(open(t, Topics.mailSent(t.project.id))).toMatchObject({
      kind: 'success',
    });
  });

  it('a failed export raises "Erneut versuchen"; the next one settles it', async () => {
    const t = await setup();
    const settings = new SettingsReader(
      new InMemoryUserSettingsRepository(),
      new SettingsSecrets(config),
    );
    const calculation = {
      calculate: (userId: string, projectId: string) =>
        t.calculate.execute(new CalculateProjectCommand(userId, projectId)),
    } as unknown as CalculationService;
    const data = new ExportDataService(
      t.snapshots,
      t.states,
      settings,
      users,
      t.files,
      t.inputs,
      calculation,
      t.hintStates,
      t.corrections,
      t.transactionEdits,
    );
    class BrokenPdf extends PdfRendererPort {
      async available() {
        return true;
      }
      async render(): Promise<Uint8Array> {
        throw new Error('Chromium crashed');
      }
    }
    const create = new CreateExportHandler(
      t.projects,
      new InMemoryProjectExportRepository(),
      data,
      new BrokenPdf(),
      t.notifications,
      t.projectNotifications,
    );
    await expect(
      create.execute(
        new CreateExportCommand('anna', t.project.id, 'simple_pdf'),
      ),
    ).rejects.toThrow('Chromium crashed');
    expect(open(t, Topics.exportFailed(t.project.id))).toMatchObject({
      kind: 'error',
      params: { kind: 'simple_pdf' },
      action: { labelKey: 'notifications.action.retry' },
    });
    await create.execute(
      new CreateExportCommand('anna', t.project.id, 'simple_xlsx'),
    );
    expect(open(t, Topics.exportFailed(t.project.id))).toBeUndefined();
  });

  it('a failed package import is reported with its code only', async () => {
    const t = await setup();
    let fail = true;
    const packages = {
      import: async () => {
        if (fail) throw new PackageError('tampered', 'entry hash mismatch');
        return { projectId: t.project.id };
      },
    } as unknown as ProjectPackageService;
    const handler = new ImportProjectPackageHandler(
      packages,
      t.notifications,
      t.projectNotifications,
    );
    await expect(
      handler.execute(
        new ImportProjectPackageCommand('anna', new Uint8Array([1, 2])),
      ),
    ).rejects.toThrow();
    expect(open(t, Topics.packageImportFailed())).toMatchObject({
      kind: 'error',
      params: { reason: 'tampered' },
    });
    fail = false;
    await handler.execute(
      new ImportProjectPackageCommand('anna', new Uint8Array([1, 2])),
    );
    expect(open(t, Topics.packageImportFailed())).toBeUndefined();
  });
});
