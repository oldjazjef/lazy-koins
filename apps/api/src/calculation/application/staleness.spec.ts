import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ChangeProjectFileCommand,
  ChangeProjectFileHandler,
} from '../../files/application/commands/change-project-file.command';
import {
  ReapplyMappingCommand,
  ReapplyMappingHandler,
} from '../../files/application/commands/reapply-mapping.command';
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
  CreateMappingCommand,
  CreateMappingHandler,
  UpdateMappingCommand,
  UpdateMappingHandler,
} from '../../mappings/application/commands/mapping.commands';
import { ListMyProjectsQuery } from '../../projects/application/queries/list-my-projects.query';
import { calculationSetup } from '../testing/calculation-fixture';
import {
  CalculateProjectCommand,
  CreateCorrectionCommand,
  GetResultQuery,
  GetResultStatusQuery,
  SetCorrectionUndoneCommand,
  UpdateOpenItemCommand,
} from './calculation.handlers';

/** The engine's synthetic Kraken ledger + mapping — never real data. */
const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(
      resolve(
        __dirname,
        `../../../../../libs/engine/src/mapping/fixtures/${name}`,
      ),
    ),
  );

/**
 * User rule (08.10.2026): every change that decides the result makes the snapshot stale, and
 * result, project list and header say so alike ("Daten geändert – neu berechnen"). Changes that
 * do not decide it (ticking an open item) leave it fresh.
 */
describe('stale snapshot after every relevant change (F7.6)', () => {
  async function setup() {
    const t = await calculationSetup();
    const analysis = new FileAnalysisService(t.reader, t.mappings);
    const handlers = {
      upload: new UploadProjectFileHandler(t.projects, t.files, analysis),
      remove: new RemoveProjectFileHandler(t.projects, t.files),
      change: new ChangeProjectFileHandler(
        t.projects,
        t.files,
        t.mappings,
        analysis,
      ),
      createMapping: new CreateMappingHandler(t.mappings),
      updateMapping: new UpdateMappingHandler(t.mappings, t.files),
      reapply: new ReapplyMappingHandler(
        t.projects,
        t.files,
        t.mappings,
        analysis,
      ),
    };
    const id = t.project.id;
    const recalculate = () =>
      t.calculate.execute(new CalculateProjectCommand('anna', id));
    /** The three places that show it: result, header status, project list. */
    const staleEverywhere = async () => {
      const result = await t.result.execute(new GetResultQuery('anna', id));
      const status = await t.status.execute(
        new GetResultStatusQuery('anna', id),
      );
      const [entry] = await t.list.execute(new ListMyProjectsQuery('anna'));
      expect(status.stale).toBe(result.stale);
      expect(entry?.stale).toBe(result.stale);
      return result.stale;
    };
    await recalculate();
    expect(await staleEverywhere()).toBe(false);
    return { t, h: handlers, id, recalculate, staleEverywhere };
  }

  it('reports "never calculated" as not stale in header and list', async () => {
    const t = await calculationSetup();
    expect(
      await t.status.execute(new GetResultStatusQuery('anna', t.project.id)),
    ).toEqual({ calculatedAt: null, stale: false });
    const [entry] = await t.list.execute(new ListMyProjectsQuery('anna'));
    expect(entry).toMatchObject({ figures: null, stale: false });
  });

  it('a file added, reassigned or removed', async () => {
    const { t, h, id, recalculate, staleEverywhere } = await setup();
    // A file nothing can read yet (needs a mapping) does not change the result …
    await h.upload.execute(
      new UploadProjectFileCommand(
        'anna',
        id,
        'kraken-ledger-2024.csv',
        fixture('kraken-ledger-2024.csv'),
      ),
    );
    expect(await staleEverywhere()).toBe(false);
    // … a readable one does.
    const added = await h.upload.execute(
      new UploadProjectFileCommand(
        'anna',
        id,
        'binance-bestaende.csv',
        new TextEncoder().encode(
          [
            'Plattform,Konto,Asset,Menge,Stichtag,Preis CHF,Preis USD,Beleg',
            'binance,spot,BTC,0.001,2025-12-31,,,',
          ].join('\n'),
        ),
      ),
    );
    expect(await staleEverywhere()).toBe(true);

    await recalculate();
    await h.change.execute(
      new ChangeProjectFileCommand('anna', id, added.id, {
        mode: 'evidenceOnly',
      }),
    );
    expect(await staleEverywhere()).toBe(true);

    await recalculate();
    await h.remove.execute(
      new RemoveProjectFileCommand('anna', id, t.bookingsFile.id),
    );
    expect(await staleEverywhere()).toBe(true);
  });

  it('a mapping edited, and re-applied', async () => {
    const { h, id, recalculate, staleEverywhere } = await setup();
    const spec: unknown = JSON.parse(
      new TextDecoder().decode(fixture('kraken-ledger.mapping.json')),
    );
    const mapping = await h.createMapping.execute(
      new CreateMappingCommand('anna', spec, 'manual'),
    );
    const file = await h.upload.execute(
      new UploadProjectFileCommand(
        'anna',
        id,
        'kraken-ledger-2024.csv',
        fixture('kraken-ledger-2024.csv'),
      ),
    );
    expect(file.mappingId).toBe(mapping.id);
    await recalculate();
    expect(await staleEverywhere()).toBe(false);

    await h.updateMapping.execute(
      new UpdateMappingCommand('anna', mapping.id, {
        ...(spec as object),
        name: 'Kraken (bearbeitet)',
      }),
    );
    expect(await staleEverywhere()).toBe(true);

    await recalculate();
    await h.reapply.execute(new ReapplyMappingCommand('anna', mapping.id));
    // Same spec version → the same input; the edit itself already made it stale before.
    await recalculate();
    expect(await staleEverywhere()).toBe(false);
  });

  it('a correction added, undone and redone', async () => {
    const { t, id, recalculate, staleEverywhere } = await setup();
    const view = await recalculate();
    expect(view.result).toBeDefined();
    const correction = await t.createCorrection.execute(
      new CreateCorrectionCommand(
        'anna',
        id,
        {
          type: 'price_override',
          asset: 'BTC',
          date: '2025-12-31',
          priceChf: '1',
        },
        'Kurs laut Beleg',
      ),
    );
    expect(await staleEverywhere()).toBe(true);

    await recalculate();
    await t.undo.execute(
      new SetCorrectionUndoneCommand('anna', id, correction.id, true),
    );
    expect(await staleEverywhere()).toBe(true);

    await recalculate();
    await t.undo.execute(
      new SetCorrectionUndoneCommand('anna', id, correction.id, false),
    );
    expect(await staleEverywhere()).toBe(true);
  });

  it('a global transaction edit of one of its transactions, undone (F9.8)', async () => {
    const { t, recalculate, staleEverywhere } = await setup();
    const view = await recalculate();
    const bookingId = view.result?.income[0]?.bookingId ?? '';
    // An edit of a transaction no file of the project has leaves it current.
    await t.transactionEdits.add('anna', [
      { key: 'ff:1', changes: { kind: 'spam' }, reason: 'x', source: 'user' },
    ]);
    expect(await staleEverywhere()).toBe(false);
    const [edit] = await t.transactionEdits.add('anna', [
      {
        key: bookingId,
        changes: { kind: 'transfer' },
        reason: 'Umbuchung',
        source: 'user',
      },
    ]);
    expect(await staleEverywhere()).toBe(true);
    await recalculate();
    await t.transactionEdits.setStatus(edit?.id ?? '', 'undone');
    expect(await staleEverywhere()).toBe(true);
  });

  it('rates overridden or removed, and the tax currency', async () => {
    const { t, id, recalculate, staleEverywhere } = await setup();
    const manual = {
      kind: 'price' as const,
      asset: 'DOT',
      currency: 'CHF',
      date: '2025-12-31',
      value: '4',
      source: 'manual' as const,
    };
    await t.rates.upsertMany(id, [manual]);
    expect(await staleEverywhere()).toBe(true);

    await recalculate();
    await t.rates.delete(id, manual);
    expect(await staleEverywhere()).toBe(true);

    await recalculate();
    await t.projects.update(id, { taxCurrency: 'EUR' });
    expect(await staleEverywhere()).toBe(true);
  });

  it('a wallet included, and a manual balance', async () => {
    const { t, id, recalculate, staleEverywhere } = await setup();
    const wallet = await t.wallets.create({
      ownerId: 'anna',
      label: 'Ledger',
      address: '0x0000000000000000000000000000000000000001',
      addressKind: 'evm',
      networks: ['ethereum'],
      notes: '',
    });
    await t.wallets.addToProject(id, wallet.id);
    expect(await staleEverywhere()).toBe(true);

    await recalculate();
    // A manual balance at 31.12. with its receipt (F6.5).
    await t.wallets.addBalance({
      projectId: id,
      walletId: wallet.id,
      network: 'ethereum',
      asset: 'ETH',
      quantity: '1.5',
      asOf: '2025-12-31',
      evidenceFileId: 'receipt',
      note: '',
    });
    expect(await staleEverywhere()).toBe(true);
  });

  it('a file deactivated and activated again (F5.7a): ignored, stale, then back', async () => {
    const { t, id, recalculate, staleEverywhere } = await setup();
    const toggle = new SetFileActiveHandler(t.projects, t.files);
    const before = await recalculate();
    const sha = t.bookingsFile.sha256;
    // Record ids are `<file sha>:<row>` — every figure names the records behind it (F7.5).
    expect(JSON.stringify(before.result)).toContain(sha);
    expect(before.result?.income.length).toBeGreaterThan(0);

    await toggle.execute(
      new SetFileActiveCommand('anna', id, t.bookingsFile.id, false, 'doppelt'),
    );
    expect(await staleEverywhere()).toBe(true);
    const without = await recalculate();
    // Nothing of the deactivated file is in the result — so no drill-down shows its records.
    expect(JSON.stringify(without.result)).not.toContain(sha);
    expect(without.result?.income).toEqual([]);
    expect(await staleEverywhere()).toBe(false);

    // The file stays in the project, its mapping status unchanged.
    const stored = await t.files.findById(t.bookingsFile.id);
    expect(stored).toMatchObject({
      status: 'standard',
      disabledNote: 'doppelt',
    });
    expect(stored?.disabledAt).not.toBeNull();

    await toggle.execute(
      new SetFileActiveCommand('anna', id, t.bookingsFile.id, true),
    );
    expect(await staleEverywhere()).toBe(true);
    const again = await recalculate();
    expect(again.result?.totals).toEqual(before.result?.totals);
    expect(again.snapshot?.inputHash).toBe(before.snapshot?.inputHash);
  });

  it('stays fresh when an open item is ticked off', async () => {
    const { t, id, staleEverywhere } = await setup();
    await t.tick.execute(
      new UpdateOpenItemCommand('anna', id, 'any-item', { done: true }),
    );
    expect(await staleEverywhere()).toBe(false);
  });
});
