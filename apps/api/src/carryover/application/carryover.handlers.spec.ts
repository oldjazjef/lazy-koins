import { WalletDerivedFiles } from '../../wallets/application/wallet-derived-files';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  CalculateProjectCommand,
  CreateCorrectionCommand,
  UpdateOpenItemCommand,
} from '../../calculation/application/calculation.handlers';
import {
  SetFileActiveCommand,
  SetFileActiveHandler,
} from '../../files/application/commands/set-file-active.command';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from '../../files/application/commands/upload-project-file.command';
import { bundleSetup } from '../testing/bundle-fixture';
import {
  CreateFollowUpProjectCommand,
  CreateFollowUpProjectHandler,
  GetFollowUpOptionsHandler,
  GetFollowUpOptionsQuery,
  GetTakeOverSourcesHandler,
  GetTakeOverSourcesQuery,
  ListCarryoversHandler,
  ListCarryoversQuery,
  TakeOverFilesCommand,
  TakeOverFilesHandler,
} from './carryover.handlers';

/** A synthetic ledger that reaches into 2026 (preselected for the follow-up). */
const LEDGER_2026 = [
  'Zeitpunkt,Plattform,Konto,Art,Asset,Menge,Gebühr,Gebühr-Asset,Preis CHF,Preis USD,Referenz,Notiz',
  '2025-11-03T10:00:00Z,bitstamp,main,deposit,CHF,100,,,,,,',
  '2026-02-01T10:00:00Z,bitstamp,main,unknown,ETH,0.1,,,,,,',
].join('\n');

async function setup() {
  const t = await bundleSetup();
  const upload = new UploadProjectFileHandler(t.projects, t.files, t.analysis);
  const ledger = await upload.execute(
    new UploadProjectFileCommand(
      'anna',
      t.project.id,
      'bitstamp.csv',
      new TextEncoder().encode(LEDGER_2026),
    ),
  );
  return {
    ...t,
    ledger,
    options: new GetFollowUpOptionsHandler(
      t.projects,
      t.files,
      t.corrections,
      t.snapshots,
      t.states,
      t.carryovers,
      t.wallets,
    ),
    followUp: new CreateFollowUpProjectHandler(
      t.projects,
      t.files,
      t.corrections,
      t.snapshots,
      t.states,
      t.carryovers,
      t.bundles,
      t.wallets,
      new WalletDerivedFiles(t.wallets, t.projects, t.files, t.analysis),
    ),
    sources: new GetTakeOverSourcesHandler(t.projects, t.files),
    takeOver: new TakeOverFilesHandler(t.projects, t.files, t.bundles),
    listCarryovers: new ListCarryoversHandler(
      t.projects,
      t.carryovers,
      t.states,
    ),
  };
}

describe('follow-up project (F4.4a)', () => {
  it('offers files (preselected when they reach into the new year), carryable corrections, open items and notes', async () => {
    const t = await setup();
    // Year-bound: an override — never offered. Reclassify of a booking in the 2026 ledger: offered.
    await t.createCorrection.execute(
      new CreateCorrectionCommand(
        'anna',
        t.project.id,
        {
          type: 'price_override',
          asset: 'ETH',
          date: '2025-12-31',
          priceChf: '3000',
        },
        'ESTV',
      ),
    );
    const reclassify = await t.createCorrection.execute(
      new CreateCorrectionCommand(
        'anna',
        t.project.id,
        {
          type: 'reclassify',
          bookingId: `${t.ledger.sha256}::3`,
          kind: 'income_airdrop',
        },
        'Airdrop',
      ),
    );
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );

    const options = await t.options.execute(
      new GetFollowUpOptionsQuery('anna', t.project.id),
    );
    expect(options.taxYear).toBe(2026);
    expect(options.canton).toBe('ZH');
    expect(options.walletsAvailable).toBe(true);
    expect(options.wallets).toEqual([]);
    expect(options.files.map((f) => [f.displayName, f.preselected])).toEqual([
      ['bitstamp.csv', true],
      ['bestaende.csv', false],
      ['buchungen.csv', false],
    ]);
    expect(options.corrections.map((c) => c.id)).toEqual([reclassify.id]);
    expect(options.openItems.length).toBeGreaterThan(0);
  });

  it('offers a deactivated file unticked; ticked anyway, it is linked active (F5.7a)', async () => {
    const t = await setup();
    await new SetFileActiveHandler(t.projects, t.files).execute(
      new SetFileActiveCommand('anna', t.project.id, t.ledger.id, false, 'alt'),
    );
    const options = await t.options.execute(
      new GetFollowUpOptionsQuery('anna', t.project.id),
    );
    // It reaches into 2026 (would be preselected) — but it is deactivated.
    expect(
      options.files.map((f) => [f.displayName, f.preselected, f.active]),
    ).toEqual([
      ['bitstamp.csv', false, false],
      ['bestaende.csv', false, true],
      ['buchungen.csv', false, true],
    ]);
    const { projectId } = await t.followUp.execute(
      new CreateFollowUpProjectCommand('anna', t.project.id, {
        name: 'Steuern 2026',
        taxYear: 2026,
        canton: 'ZH',
        fileIds: [t.ledger.id],
        correctionIds: [],
        openItemKeys: [],
        notes: false,
      }),
    );
    const [linked] = await t.files.listByProject(projectId);
    expect(linked).toMatchObject({ sha256: t.ledger.sha256, disabledAt: null });
    // The source keeps its own state.
    expect((await t.files.findById(t.ledger.id))?.disabledNote).toBe('alt');

    // F4.4 take-over: shown with its state, linked active as well.
    const target = await t.projects.create('anna', {
      name: 'Andere 2026',
      taxYear: 2026,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    const sources = await t.sources.execute(
      new GetTakeOverSourcesQuery('anna', target.id),
    );
    const source = sources.find((s) => s.projectId === t.project.id);
    expect(
      source?.files.find((f) => f.projectFileId === t.ledger.id),
    ).toMatchObject({ active: false, preselected: false });
    await t.takeOver.execute(
      new TakeOverFilesCommand('anna', target.id, [t.ledger.id]),
    );
    const [taken] = await t.files.listByProject(target.id);
    expect(taken?.disabledAt).toBeNull();
  });

  it('creates the project: files linked (no second blob), items copied, origin recorded, source unchanged', async () => {
    const t = await setup();
    const correction = await t.createCorrection.execute(
      new CreateCorrectionCommand(
        'anna',
        t.project.id,
        {
          type: 'manual_booking',
          booking: {
            platform: 'wallet',
            accountId: 'main',
            timestamp: '2025-06-01T00:00:00Z',
            asset: 'BTC',
            quantity: '0.1',
            kind: 'deposit',
          },
        },
        'Vergessene Wallet',
      ),
    );
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const options = await t.options.execute(
      new GetFollowUpOptionsQuery('anna', t.project.id),
    );
    const item = options.openItems[0];
    if (!item) throw new Error('expected an open item');
    await t.tick.execute(
      new UpdateOpenItemCommand('anna', t.project.id, item.key, {
        note: 'Beleg anfordern',
      }),
    );
    await t.projects.update(t.project.id, { notes: 'Notiz 2025' });
    // A closed source project is fine — it is only read.
    await t.projects.update(t.project.id, { status: 'closed' });
    const blobs = t.files.stored.size;
    const sourceFiles = (await t.files.listByProject(t.project.id)).length;

    const { projectId } = await t.followUp.execute(
      new CreateFollowUpProjectCommand('anna', t.project.id, {
        name: 'Steuern 2026',
        taxYear: 2026,
        canton: 'ZH',
        fileIds: [t.ledger.id, t.bookingsFile.id],
        correctionIds: [correction.id],
        openItemKeys: [item.key],
        notes: true,
      }),
    );

    const created = await t.projects.findById(projectId);
    expect(created).toMatchObject({
      name: 'Steuern 2026',
      taxYear: 2026,
      notes: 'Notiz 2025',
      status: 'in_progress',
    });
    const files = await t.files.listByProject(projectId);
    expect(files.map((f) => f.origin)).toEqual([
      `from_project:${t.project.id}`,
      `from_project:${t.project.id}`,
    ]);
    expect(t.files.stored.size).toBe(blobs);
    expect(await t.corrections.listByProject(projectId)).toEqual([
      expect.objectContaining({ reason: 'Vergessene Wallet' }),
    ]);
    const carried = await t.listCarryovers.execute(
      new ListCarryoversQuery('anna', projectId),
    );
    expect(carried.map((c) => c.kind)).toEqual([
      'project',
      'file',
      'file',
      'correction',
      'open_item',
      'notes',
    ]);
    expect(carried.every((c) => c.sourceProjectId === t.project.id)).toBe(true);
    expect(carried.find((c) => c.kind === 'open_item')).toMatchObject({
      done: false,
      note: 'Beleg anfordern',
    });
    // The source project is unchanged.
    expect((await t.files.listByProject(t.project.id)).length).toBe(
      sourceFiles,
    );
    expect(await t.carryovers.listByProject(t.project.id)).toEqual([]);
  });

  it("refuses a year-bound correction and someone else's project", async () => {
    const t = await setup();
    const override = await t.createCorrection.execute(
      new CreateCorrectionCommand(
        'anna',
        t.project.id,
        {
          type: 'price_override',
          asset: 'ETH',
          date: '2025-12-31',
          priceChf: '3000',
        },
        'ESTV',
      ),
    );
    const input = {
      name: 'Steuern 2026',
      taxYear: 2026,
      canton: 'ZH',
      fileIds: [],
      correctionIds: [override.id],
      openItemKeys: [],
      notes: false,
    };
    await expect(
      t.followUp.execute(
        new CreateFollowUpProjectCommand('anna', t.project.id, input),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.followUp.execute(
        new CreateFollowUpProjectCommand('bob', t.project.id, {
          ...input,
          correctionIds: [],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('files from another project (F4.4)', () => {
  it("lists other projects' files and links the chosen ones once", async () => {
    const t = await setup();
    const target = await t.projects.create('anna', {
      name: 'Steuern 2026',
      taxYear: 2026,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    const sources = await t.sources.execute(
      new GetTakeOverSourcesQuery('anna', target.id),
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]?.files.every((f) => !f.inTarget)).toBe(true);

    const blobs = t.files.stored.size;
    expect(
      await t.takeOver.execute(
        new TakeOverFilesCommand('anna', target.id, [t.ledger.id, t.ledger.id]),
      ),
    ).toEqual({ added: 1, skipped: 0 });
    expect(
      await t.takeOver.execute(
        new TakeOverFilesCommand('anna', target.id, [t.ledger.id]),
      ),
    ).toEqual({ added: 0, skipped: 1 });
    expect(t.files.stored.size).toBe(blobs);
    const [linked] = await t.files.listByProject(target.id);
    expect(linked).toMatchObject({
      sha256: t.ledger.sha256,
      origin: `from_project:${t.project.id}`,
      status: 'standard',
    });

    await t.projects.update(target.id, { status: 'closed' });
    await expect(
      t.takeOver.execute(
        new TakeOverFilesCommand('anna', target.id, [t.bookingsFile.id]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.takeOver.execute(
        new TakeOverFilesCommand('bob', target.id, [t.ledger.id]),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('wallets in the follow-up project (F4.4a, F6)', () => {
  it('offers the wallets preselected, links them, re-derives their files and never links derived files', async () => {
    const t = await setup();
    const wallet = await t.wallets.create({
      ownerId: 'anna',
      label: 'Ledger',
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
      movements: [
        {
          txHash: '0x01',
          timestamp: '2025-06-01T00:00:00.000Z',
          asset: 'ETH',
          tokenId: null,
          tokenName: null,
          quantity: '1.5',
          fee: null,
          feeAsset: null,
          type: 'transfer',
          counterparty: null,
          verified: null,
        },
      ],
      info: {},
      fetchedAt: '2026-01-02T00:00:00.000Z',
    });
    const derived = new WalletDerivedFiles(
      t.wallets,
      t.projects,
      t.files,
      t.analysis,
    );
    await derived.sync('anna', t.project.id, wallet);
    const sourceDerived = [...t.files.entries.values()].find(
      (e) => e.projectId === t.project.id && e.origin === `wallet:${wallet.id}`,
    );
    expect(sourceDerived).toBeDefined();

    const options = await t.options.execute(
      new GetFollowUpOptionsQuery('anna', t.project.id),
    );
    expect(options.wallets).toEqual([
      expect.objectContaining({
        walletId: wallet.id,
        label: 'Ledger',
        preselected: true,
      }),
    ]);
    expect(
      options.files.some((f) => f.projectFileId === sourceDerived?.id),
    ).toBe(false);

    const { projectId } = await t.followUp.execute(
      new CreateFollowUpProjectCommand('anna', t.project.id, {
        name: 'Steuern 2026',
        taxYear: 2026,
        canton: 'ZH',
        fileIds: [sourceDerived?.id ?? ''],
        correctionIds: [],
        openItemKeys: [],
        notes: false,
        walletIds: [wallet.id],
      }),
    );
    expect(await t.wallets.listWalletIds(projectId)).toEqual([wallet.id]);
    const files = [...t.files.entries.values()].filter(
      (e) => e.projectId === projectId,
    );
    // One derived file, made for the new project — the source's copy was not linked.
    expect(files.map((f) => f.origin)).toEqual([`wallet:${wallet.id}`]);
    const carried = await t.listCarryovers.execute(
      new ListCarryoversQuery('anna', projectId),
    );
    expect(
      carried.filter((c) => c.kind === 'wallet').map((c) => c.label),
    ).toEqual(['Ledger']);

    await expect(
      t.followUp.execute(
        new CreateFollowUpProjectCommand('anna', t.project.id, {
          name: 'Steuern 2026 b',
          taxYear: 2026,
          canton: 'ZH',
          fileIds: [],
          correctionIds: [],
          openItemKeys: [],
          notes: false,
          walletIds: ['00000000-0000-7000-8000-999999999999'],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
