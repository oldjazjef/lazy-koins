import { Logger } from '@nestjs/common';
import { NotificationService } from '../../notifications/application/notification.service';
import { Topics } from '../../notifications/domain/notification';
import { InMemoryNotificationRepository } from '../../notifications/testing/in-memory-notification.repository';
import type { ConfigService } from '@nestjs/config';
import type { CommandBus } from '@nestjs/cqrs';
import { SecretBox } from '../../common/crypto/secret-box';
import type { Env } from '../../config/env';
import { CalculateProjectCommand } from '../../calculation/application/calculation.handlers';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import {
  SetFileActiveCommand,
  SetFileActiveHandler,
} from '../../files/application/commands/set-file-active.command';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from '../../files/application/commands/upload-project-file.command';
import { ChainSources } from '../../integrations/chains/chain-sources';
import {
  SettingsReader,
  SettingsSecrets,
  UpdateSettingsCommand,
  UpdateSettingsHandler,
} from '../../settings/application/settings.handlers';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import { walletOrigin } from '../domain/wallet';
import { InMemoryChainSettingsRepository } from '../testing/in-memory-wallet.repository';
import { ChainGate, ChainRuntime } from './chain-gate';
import {
  GetChainSettingsHandler,
  GetChainSettingsQuery,
  SaveChainSettingsCommand,
  SaveChainSettingsHandler,
  TestChainServiceCommand,
  TestChainServiceHandler,
} from './chain-settings.handlers';
import {
  AddManualBalanceCommand,
  AddManualBalanceHandler,
  AddProjectWalletCommand,
  AddProjectWalletHandler,
  ListProjectWalletsHandler,
  ListProjectWalletsQuery,
  RemoveProjectWalletCommand,
  RemoveProjectWalletHandler,
} from './project-wallets.handlers';
import { WalletDerivedFiles } from './wallet-derived-files';
import { WalletViews } from './wallet-views';
import {
  CheckNetworksCommand,
  CheckNetworksHandler,
  CreateWalletCommand,
  CreateWalletHandler,
  DeleteWalletCommand,
  DeleteWalletHandler,
  FetchWalletCommand,
  FetchWalletHandler,
  inspectAddress,
  ListWalletTokensHandler,
  SetTokenOverrideCommand,
  SetTokenOverrideHandler,
  UpdateWalletCommand,
  UpdateWalletHandler,
} from './wallets.handlers';

const KEY = 'a-test-key-that-is-long-enough-for-aes-256-gcm';
const EVM = '0x1111111111111111111111111111111111111111';
const SEED = `${'abandon '.repeat(11)}about`;

async function setup() {
  const base = await calculationSetup();
  const { projects, files, wallets, reader, mappings } = base;
  const config = { get: () => KEY } as unknown as ConfigService<Env, true>;
  const userSettings = new InMemoryUserSettingsRepository();
  const secrets = new SettingsSecrets(config);
  const settingsReader = new SettingsReader(userSettings, secrets);
  const updateSettings = new UpdateSettingsHandler(
    userSettings,
    secrets,
    settingsReader,
  );
  const chainSettings = new InMemoryChainSettingsRepository();
  const runtime = new ChainRuntime(new SecretBox(KEY), true, false);
  const gate = new ChainGate(chainSettings, settingsReader, runtime);
  const sources = ChainSources.fake();
  const analysis = new FileAnalysisService(reader, mappings);
  const derived = new WalletDerivedFiles(wallets, projects, files, analysis);
  const views = new WalletViews(wallets, projects);
  const tokens = new ListWalletTokensHandler(wallets);
  const commands = {
    execute: (command: unknown) =>
      updateSettings.execute(command as UpdateSettingsCommand),
  } as unknown as CommandBus;
  const getSettings = new GetChainSettingsHandler(gate, settingsReader);
  return {
    ...base,
    userSettings,
    chainSettings,
    updateSettings,
    gate,
    sources,
    derived,
    views,
    create: new CreateWalletHandler(wallets, views),
    update: new UpdateWalletHandler(wallets, views, derived),
    remove: new DeleteWalletHandler(wallets, projects, derived),
    check: new CheckNetworksHandler(wallets, gate, sources, views),
    fetch: new FetchWalletHandler(wallets, gate, sources, derived, views),
    setToken: new SetTokenOverrideHandler(wallets, derived, tokens),
    tokens,
    list: new ListProjectWalletsHandler(projects, wallets, files, views),
    add: new AddProjectWalletHandler(projects, wallets, derived),
    detach: new RemoveProjectWalletHandler(projects, wallets, derived),
    addBalance: new AddManualBalanceHandler(projects, wallets, files, derived),
    upload: new UploadProjectFileHandler(projects, files, analysis),
    getSettings,
    saveSettings: new SaveChainSettingsHandler(
      chainSettings,
      gate,
      commands,
      getSettings,
    ),
    testService: new TestChainServiceHandler(gate, sources),
  };
}

const walletFiles = (t: Awaited<ReturnType<typeof setup>>, walletId: string) =>
  [...t.files.entries.values()].filter(
    (e) => e.projectId === t.project.id && e.origin === walletOrigin(walletId),
  );

describe('wallets: seed phrases and private keys (F6.2)', () => {
  it('refuses them in every field, stores nothing and echoes nothing (not even in logs)', async () => {
    const t = await setup();
    const logged: string[] = [];
    const spies = (['log', 'error', 'warn', 'debug', 'verbose'] as const).map(
      (level) =>
        vi
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            logged.push(JSON.stringify(args));
          }),
    );
    const consoleSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      });
    const inputs = [
      { label: 'Ledger', address: SEED },
      { label: SEED, address: EVM },
      { label: 'Ledger', address: EVM, notes: `backup: ${SEED}` },
      { label: 'Ledger', address: `0x${'ab'.repeat(32)}` },
      {
        label: 'Ledger',
        address: '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ',
      },
    ];
    for (const input of inputs) {
      const error = await t.create
        .execute(new CreateWalletCommand('anna', input))
        .catch((e: unknown) => e as { getResponse(): unknown });
      const body = JSON.stringify(error.getResponse());
      expect(body).toContain('secretRefused');
      for (const secretPart of ['abandon', 'about', 'abab', '5HueCGU8']) {
        expect(body).not.toContain(secretPart);
        expect(JSON.stringify(error)).not.toContain(secretPart);
      }
    }
    expect(t.wallets.wallets.size).toBe(0);
    expect(logged.join('\n')).not.toContain('abandon');
    expect(inspectAddress(SEED)).toEqual({
      addressKind: null,
      networks: [],
      secret: 'seedPhrase',
    });
    for (const spy of [...spies, consoleSpy]) spy.mockRestore();
  });

  it('also refuses a seed phrase pasted into the notes on update', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', { label: 'Ledger', address: EVM }),
    );
    await expect(
      t.update.execute(
        new UpdateWalletCommand('anna', wallet.id, { notes: SEED }),
      ),
    ).rejects.toMatchObject({ response: { code: 'secretRefused' } });
    expect(t.wallets.wallets.get(wallet.id)?.notes).toBe('');
  });
});

describe('wallets (F6.1, F6.3, F6.4, F6.6) with the fake chains', () => {
  it('creates a wallet on every possible network, refuses unknown addresses and foreign networks', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', { label: ' Ledger ', address: EVM }),
    );
    expect(wallet).toMatchObject({
      label: 'Ledger',
      addressKind: 'evm',
      networks: ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base'],
    });
    await expect(
      t.create.execute(
        new CreateWalletCommand('anna', { label: 'x', address: 'nonsense' }),
      ),
    ).rejects.toMatchObject({ response: { code: 'unknownAddress' } });
    await expect(
      t.create.execute(
        new CreateWalletCommand('anna', {
          label: 'x',
          address: EVM,
          networks: ['bitcoin'],
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'networkNotForAddress' } });
  });

  it('checks every EVM chain (F6.4); a chain not on the plan is recorded, not thrown', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', { label: 'Ledger', address: EVM }),
    );
    const checked = await t.check.execute(
      new CheckNetworksCommand('anna', wallet.id),
    );
    expect(
      checked.perNetwork.map((n) => [n.network, n.used, n.checkError]),
    ).toEqual([
      ['ethereum', true, null],
      ['bsc', null, 'chainNotOnPlan'],
      ['polygon', true, null],
      ['arbitrum', false, null],
      ['optimism', false, null],
      ['base', true, null],
    ]);
    expect(checked.checkedAt).not.toBeNull();
  });

  it('respects the online switch (F11.3)', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', { label: 'Ledger', address: EVM }),
    );
    await t.updateSettings.execute(
      new UpdateSettingsCommand('anna', { onlineRates: false }),
    );
    await expect(
      t.fetch.execute(new FetchWalletCommand('anna', wallet.id)),
    ).rejects.toMatchObject({ response: { code: 'offline' } });
  });

  it('fetch → derived standard file in the project → calculation; same data keeps the file', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', {
        label: 'Ledger',
        address: EVM,
        networks: ['ethereum', 'polygon', 'base', 'bsc'],
      }),
    );
    await t.add.execute(
      new AddProjectWalletCommand('anna', t.project.id, wallet.id),
    );
    expect(walletFiles(t, wallet.id)).toHaveLength(0);
    await t.check.execute(new CheckNetworksCommand('anna', wallet.id));
    const fetched = await t.fetch.execute(
      new FetchWalletCommand('anna', wallet.id),
    );
    expect(
      fetched.perNetwork
        .filter((n) => n.selected)
        .map((n) => [n.network, n.status, n.errorCode]),
    ).toEqual([
      ['ethereum', 'ok', null],
      ['bsc', 'error', 'chainNotOnPlan'],
      ['polygon', 'ok', null],
      ['base', 'ok', null],
    ]);
    expect(
      fetched.perNetwork.find((n) => n.network === 'polygon')?.spamTokens,
    ).toBe(1);
    const [file] = walletFiles(t, wallet.id);
    expect(file?.displayName).toBe('Ledger.wallet-buchungen.csv');
    expect(file?.analysis.status).toBe('standard');

    const view = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const result = view.result;
    if (!result) throw new Error('no result');
    const eth = result.positions.find(
      (p) =>
        p.platform === 'Ledger · ethereum' &&
        p.accountId === 'ethereum' &&
        p.asset === 'ETH',
    );
    // 1.2 − 0.3 − 0.000525 − 0.0011 − 0.0004 (failed tx: gas only)
    expect(eth?.quantity).toBe('0.897975');
    expect(result.positions.find((p) => p.asset === 'SPAM:USDT')?.status).toBe(
      'spam',
    );
    const check = result.checks.find((c) => c.kind === 'walletNetworks');
    expect(check?.light).toBe('yellow');
    expect(
      result.openItems
        .filter((i) => i.check === 'walletNetworks')
        .map((i) => [i.reason, i.accountId]),
    ).toEqual([
      // The BNB Chain check failed, so not every network is checked yet.
      ['walletNetworksUnchecked', null],
      ['walletFetchFailed', 'bsc'],
    ]);

    // Re-fetch without news: the same bytes, the same file.
    await t.fetch.execute(new FetchWalletCommand('anna', wallet.id));
    expect(walletFiles(t, wallet.id).map((f) => f.id)).toEqual([file?.id]);
  });

  it('"kein Spam" (F6.6) rewrites the derived file; the old one goes', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', {
        label: 'Ledger',
        address: EVM,
        networks: ['ethereum'],
      }),
    );
    await t.add.execute(
      new AddProjectWalletCommand('anna', t.project.id, wallet.id),
    );
    await t.fetch.execute(new FetchWalletCommand('anna', wallet.id));
    const before = walletFiles(t, wallet.id)[0]?.id;
    const [ethereum] = await t.tokens.execute({
      userId: 'anna',
      walletId: wallet.id,
    });
    const scam = ethereum?.tokens.find((tok) => tok.spam);
    expect(scam?.reasons).toContain('namePattern');
    const after = await t.setToken.execute(
      new SetTokenOverrideCommand(
        'anna',
        wallet.id,
        'ethereum',
        scam?.tokenKey ?? '',
        true,
      ),
    );
    expect(
      after[0]?.tokens.find((tok) => tok.tokenKey === scam?.tokenKey),
    ).toMatchObject({ spam: false, overridden: true });
    const files = walletFiles(t, wallet.id);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).not.toBe(before);
  });

  it('a deactivated derived file stays deactivated: same bytes kept, new bytes take it over (F5.7a)', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', {
        label: 'Ledger',
        address: EVM,
        networks: ['ethereum'],
      }),
    );
    await t.add.execute(
      new AddProjectWalletCommand('anna', t.project.id, wallet.id),
    );
    await t.fetch.execute(new FetchWalletCommand('anna', wallet.id));
    const [file] = walletFiles(t, wallet.id);
    if (!file) throw new Error('no derived file');
    const off = await new SetFileActiveHandler(t.projects, t.files).execute(
      new SetFileActiveCommand('anna', t.project.id, file.id, false, 'Test'),
    );

    // Same data again: the same file, still deactivated.
    await t.fetch.execute(new FetchWalletCommand('anna', wallet.id));
    const same = await t.files.findById(file.id);
    expect(same).toMatchObject({
      disabledAt: off.disabledAt,
      disabledNote: 'Test',
    });

    // New bytes ("kein Spam" rewrites the file): the replacement inherits the deactivation.
    const [ethereum] = await t.tokens.execute({
      userId: 'anna',
      walletId: wallet.id,
    });
    const scam = ethereum?.tokens.find((tok) => tok.spam);
    await t.setToken.execute(
      new SetTokenOverrideCommand(
        'anna',
        wallet.id,
        'ethereum',
        scam?.tokenKey ?? '',
        true,
      ),
    );
    const [replaced] = walletFiles(t, wallet.id);
    expect(replaced?.id).not.toBe(file.id);
    expect(await t.files.findById(replaced?.id ?? '')).toMatchObject({
      disabledAt: off.disabledAt,
      disabledNote: 'Test',
    });
  });

  it('manual balance with a PDF receipt (F6.5) becomes a holding; removing the wallet removes its files', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', {
        label: 'Yoroi',
        address: `addr1${'q'.repeat(58)}`,
      }),
    );
    await t.add.execute(
      new AddProjectWalletCommand('anna', t.project.id, wallet.id),
    );
    await t.fetch.execute(new FetchWalletCommand('anna', wallet.id));
    const pdf = await t.upload.execute(
      new UploadProjectFileCommand(
        'anna',
        t.project.id,
        'yoroi-31-12.pdf',
        new TextEncoder().encode('%PDF-1.4 synthetic receipt'),
      ),
    );
    await expect(
      t.addBalance.execute(
        new AddManualBalanceCommand('anna', t.project.id, wallet.id, {
          network: 'cardano',
          asset: 'ada',
          quantity: '1250.5',
          evidenceFileId: t.bookingsFile.id,
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'evidenceNotPdf' } });
    await t.addBalance.execute(
      new AddManualBalanceCommand('anna', t.project.id, wallet.id, {
        network: 'cardano',
        asset: 'ada',
        quantity: '1250.5',
        evidenceFileId: pdf.id,
      }),
    );
    expect(
      walletFiles(t, wallet.id)
        .map((f) => f.displayName)
        .sort(),
    ).toEqual(['Yoroi.wallet-bestaende.csv', 'Yoroi.wallet-buchungen.csv']);
    const overview = await t.list.execute(
      new ListProjectWalletsQuery('anna', t.project.id),
    );
    expect(overview.wallets[0]?.balances[0]).toMatchObject({
      asset: 'ADA',
      asOf: '2025-12-31',
      evidenceName: 'yoroi-31-12.pdf',
    });

    const view = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const ada = view.result?.positions.find(
      (p) => p.platform === 'Yoroi · cardano',
    );
    expect(ada).toMatchObject({
      asset: 'ADA',
      quantity: '1250.5',
      quantitySource: 'statement',
    });
    // Staking rewards of the year are income (F6.3 Cardano: income only).
    expect(
      view.result?.income
        .filter((l) => l.platform === 'Yoroi · cardano')
        .map((l) => l.date),
    ).toEqual(['2025-02-27', '2025-06-06']);
    expect(
      view.result?.checks.find((c) => c.kind === 'walletNetworks')?.light,
    ).toBe('yellow');

    await t.detach.execute(
      new RemoveProjectWalletCommand('anna', t.project.id, wallet.id),
    );
    expect(walletFiles(t, wallet.id)).toHaveLength(0);
    expect(await t.wallets.listBalances(t.project.id)).toEqual([]);
  });

  it('a closed project blocks deleting its wallet (F4.5); otherwise the derived files go too', async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', {
        label: 'Ledger',
        address: EVM,
        networks: ['ethereum'],
      }),
    );
    await t.add.execute(
      new AddProjectWalletCommand('anna', t.project.id, wallet.id),
    );
    await t.fetch.execute(new FetchWalletCommand('anna', wallet.id));
    await t.projects.update(t.project.id, { status: 'closed' });
    await expect(
      t.remove.execute(new DeleteWalletCommand('anna', wallet.id)),
    ).rejects.toMatchObject({ response: { code: 'usedByClosedProject' } });
    await t.projects.update(t.project.id, { status: 'in_progress' });
    await t.remove.execute(new DeleteWalletCommand('anna', wallet.id));
    expect(walletFiles(t, wallet.id)).toHaveLength(0);
    expect(t.wallets.wallets.size).toBe(0);
  });

  it("someone else's wallet reads as missing", async () => {
    const t = await setup();
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', { label: 'Ledger', address: EVM }),
    );
    await expect(
      t.fetch.execute(new FetchWalletCommand('bob', wallet.id)),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('Einstellungen › Wallets & Netzwerke (F6.7)', () => {
  it('seals keys, shows hints only, checks URLs and tests unsaved values', async () => {
    const t = await setup();
    const view = await t.saveSettings.execute(
      new SaveChainSettingsCommand('anna', {
        etherscanKey: 'ETHERSCAN-TEST-1234',
        heliusKey: 'HELIUS-TEST-5678',
        esploraUrl: 'https://esplora.example/api',
      }),
    );
    expect(view.keys).toEqual({
      etherscan: '…1234',
      helius: '…5678',
      subscan: null,
    });
    expect(JSON.stringify(view)).not.toContain('HELIUS-TEST');
    const stored = await t.chainSettings.find('anna');
    expect(stored?.sealedHeliusKey).toMatch(/^enc:v1:/);
    expect(JSON.stringify(stored)).not.toContain('HELIUS-TEST');

    await expect(
      t.saveSettings.execute(
        new SaveChainSettingsCommand('anna', {
          esploraUrl: 'http://192.168.1.10/api',
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'privateUrl' } });

    const tested = await t.testService.execute(
      new TestChainServiceCommand('anna', 'etherscan', {
        etherscanKey: 'UNSAVED-KEY',
      }),
    );
    expect(tested).toMatchObject({ ok: true, detail: 'Fake evm' });
    expect(
      (await t.getSettings.execute(new GetChainSettingsQuery('anna'))).keys
        .etherscan,
    ).toBe('…1234');
  });
});

describe('wallet fetch notifications (F11.12)', () => {
  it('a network that fails raises "Wallet-Abruf fehlgeschlagen" — without the address', async () => {
    const t = await setup();
    const repository = new InMemoryNotificationRepository();
    const fetch = new FetchWalletHandler(
      t.wallets,
      t.gate,
      t.sources,
      t.derived,
      t.views,
      new NotificationService(repository),
    );
    const wallet = await t.create.execute(
      new CreateWalletCommand('anna', {
        label: 'Ledger',
        address: EVM,
        networks: ['ethereum', 'bsc'],
      }),
    );
    await fetch.execute(new FetchWalletCommand('anna', wallet.id));
    expect(repository.topic(Topics.walletFetchFailed(wallet.id))).toMatchObject(
      {
        kind: 'error',
        params: { label: 'Ledger', networks: 'bsc', reason: 'chainNotOnPlan' },
        action: { route: `/app/wallets/${wallet.id}` },
      },
    );
    expect(JSON.stringify(repository.all())).not.toContain(EVM);
  });
});
