import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  CalculateProjectCommand,
  CreateCorrectionCommand,
  SetCorrectionUndoneCommand,
  UpdateOpenItemCommand,
} from '../../calculation/application/calculation.handlers';
import { bundleSetup } from '../../carryover/testing/bundle-fixture';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import {
  isSafePath,
  openPackage,
  PackageError,
} from '../domain/package-format';
import { AccountPackageService } from './account-package.service';
import {
  ExportProjectPackageHandler,
  ExportProjectPackageQuery,
  ImportProjectPackageCommand,
  ImportProjectPackageHandler,
} from './packages.handlers';
import { ProjectPackageService } from './project-package.service';

const NOW = '2026-10-06T12:00:00.000Z';

async function setup() {
  const t = await bundleSetup();
  const service = new ProjectPackageService(
    t.projects,
    t.files,
    t.mappings,
    t.corrections,
    t.rates,
    t.states,
    t.exports,
    t.carryovers,
    t.bundles,
    t.analysis,
  );
  const settings = new InMemoryUserSettingsRepository();
  const users = {
    findById: async (id: string) => ({
      id,
      email: `${id}@lazykoins.dev`,
      displayName: id,
      signInProvider: 'dev',
      createdAt: NOW,
      updatedAt: NOW,
    }),
  };
  return {
    ...t,
    service,
    settings,
    account: new AccountPackageService(
      users as never,
      t.projects,
      t.mappings,
      settings,
      service,
    ),
    exportPackage: new ExportProjectPackageHandler(t.projects, service),
    importPackage: new ImportProjectPackageHandler(service),
  };
}

async function richProject(t: Awaited<ReturnType<typeof setup>>) {
  const correction = await t.createCorrection.execute(
    new CreateCorrectionCommand(
      'anna',
      t.project.id,
      {
        type: 'price_override',
        asset: 'ETH',
        date: '2025-12-31',
        priceChf: '3000',
      },
      'ESTV-Wert',
    ),
  );
  const undone = await t.createCorrection.execute(
    new CreateCorrectionCommand(
      'anna',
      t.project.id,
      {
        type: 'price_override',
        asset: 'DOT',
        date: '2025-12-31',
        priceChf: '4',
      },
      'Versuch',
    ),
  );
  await t.undo.execute(
    new SetCorrectionUndoneCommand('anna', t.project.id, undone.id, true),
  );
  const result = await t.calculate.execute(
    new CalculateProjectCommand('anna', t.project.id),
  );
  const key = result.result?.openItems[0]?.key;
  if (key)
    await t.tick.execute(
      new UpdateOpenItemCommand('anna', t.project.id, key, {
        done: true,
        note: 'erledigt',
      }),
    );
  await t.exports.create(t.project.id, {
    kind: 'simple_pdf',
    fileName: 'auszug.pdf',
    bytes: strToU8('%PDF-1.7 synthetic'),
    snapshotId: null,
    wealthChf: '100',
    incomeChf: '5',
  });
  // The internal check report (F10.2a) travels too.
  await t.exports.create(t.project.id, {
    kind: 'internal_report_pdf',
    fileName: 'pruefbericht.pdf',
    bytes: strToU8('%PDF-1.7 synthetic report'),
    snapshotId: null,
    wealthChf: '100',
    incomeChf: '5',
  });
  return { correction, wealth: result.result?.totals.wealthChf };
}

describe('project package (F10.8)', () => {
  it('writes a manifest that lists every entry with SHA-256 and size', async () => {
    const t = await setup();
    await richProject(t);
    const file = await t.exportPackage.execute(
      new ExportProjectPackageQuery('anna', t.project.id, NOW),
    );
    expect(file.fileName).toBe('steuern-2025-2025.lkproj.zip');
    const opened = openPackage(file.bytes);
    const manifest = opened.manifest as Record<string, unknown>;
    expect(manifest).toMatchObject({
      format: 'lazy-koins-project',
      formatVersion: 1,
      createdAt: NOW,
      project: { name: 'Steuern 2025', taxYear: 2025, canton: 'ZH' },
      counts: {
        files: 2,
        storedFiles: 2,
        corrections: 2,
        exports: 2,
      },
    });
    expect(opened.entries.map((e) => e.path).sort()).toEqual(
      expect.arrayContaining([
        'data/corrections.json',
        'data/rates.json',
        'data/open-items.json',
        'data/carryovers.json',
      ]),
    );
  });

  it('round trip: import into another account → same records, same totals after recalculation', async () => {
    const t = await setup();
    const { wealth } = await richProject(t);
    const file = await t.exportPackage.execute(
      new ExportProjectPackageQuery('anna', t.project.id, NOW),
    );
    const imported = await t.importPackage.execute(
      new ImportProjectPackageCommand('bob', file.bytes),
    );
    expect(imported).toMatchObject({
      name: 'Steuern 2025',
      files: 2,
      storedFilesCreated: 2,
      corrections: 2,
    });
    const project = await t.projects.findById(imported.projectId);
    expect(project).toMatchObject({ ownerId: 'bob', taxYear: 2025 });
    const corrections = await t.corrections.listByProject(imported.projectId);
    expect(corrections.map((c) => [c.reason, c.undoneAt !== null])).toEqual([
      ['ESTV-Wert', false],
      ['Versuch', true],
    ]);
    expect(await t.states.listByProject(imported.projectId)).toEqual([
      expect.objectContaining({ done: true, note: 'erledigt' }),
    ]);
    expect(
      (await t.exports.listByProject(imported.projectId)).map((e) => e.kind).sort(),
    ).toEqual(['internal_report_pdf', 'simple_pdf']);
    const again = await t.calculate.execute(
      new CalculateProjectCommand('bob', imported.projectId),
    );
    expect(again.result?.totals.wealthChf).toBe(wealth);
  });

  it('imports twice into the same account: no second blob, the name gets a suffix', async () => {
    const t = await setup();
    const file = await t.exportPackage.execute(
      new ExportProjectPackageQuery('anna', t.project.id, NOW),
    );
    const blobs = t.files.stored.size;
    const imported = await t.importPackage.execute(
      new ImportProjectPackageCommand('anna', file.bytes),
    );
    expect(imported.name).toBe('Steuern 2025 (2)');
    expect(imported.storedFilesCreated).toBe(0);
    expect(t.files.stored.size).toBe(blobs);
  });

  it('refuses tampered packages, unsafe paths and things that are no package', async () => {
    const t = await setup();
    const file = await t.exportPackage.execute(
      new ExportProjectPackageQuery('anna', t.project.id, NOW),
    );
    const entries = unzipSync(file.bytes);
    const path = Object.keys(entries).find((p) => p.startsWith('files/'));
    if (!path) throw new Error('no file entry');
    const tampered = zipSync({
      ...entries,
      [path]: strToU8(`${strFromU8(entries[path] as Uint8Array)}x`),
    });
    await expect(
      t.importPackage.execute(new ImportProjectPackageCommand('bob', tampered)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    const extra = zipSync({ ...entries, 'data/extra.json': strToU8('{}') });
    await expect(
      t.importPackage.execute(new ImportProjectPackageCommand('bob', extra)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    const slip = zipSync({ ...entries, '../evil.txt': strToU8('x') });
    expect(() => openPackage(slip)).toThrow(PackageError);
    await expect(
      t.importPackage.execute(
        new ImportProjectPackageCommand('bob', strToU8('not a zip')),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(isSafePath('files/abc')).toBe(true);
    for (const bad of ['../x', '/x', 'a/../b', 'C:/x', 'a\\b', '']) {
      expect(isSafePath(bad)).toBe(false);
    }
    // Nothing was written for bob.
    expect(await t.projects.findByOwner('bob')).toEqual([]);
  });
});

describe('account package (F10.9)', () => {
  it('holds every project, the mappings and the settings — never a key', async () => {
    const t = await setup();
    await t.settings.save('anna', {
      displayName: 'Anna Muster',
      canton: 'ZH',
      sealedKeys: { coingecko: 'enc:v1:secret' },
    });
    const bytes = await t.account.export('anna', NOW);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).some((p) => p.endsWith('.lkproj.zip'))).toBe(
      true,
    );
    const settings = strFromU8(entries['settings.json'] as Uint8Array);
    expect(settings).toContain('Anna Muster');
    expect(settings).not.toContain('enc:v1');
    expect(settings).not.toContain('secret');

    const imported = await t.account.import('bob', bytes);
    expect(imported.projects).toHaveLength(1);
    expect(imported.settingsApplied).toBe(true);
    expect((await t.settings.find('bob'))?.sealedKeys.coingecko).toBeNull();
  });
});
