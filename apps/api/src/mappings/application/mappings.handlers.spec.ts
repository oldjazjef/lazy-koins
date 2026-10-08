import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { NOT_ANALYSED } from '../../files/domain/project-file';
import { InMemoryProjectFileRepository } from '../../files/testing/in-memory-project-file.repository';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import { InMemoryImportMappingRepository } from '../testing/in-memory-import-mapping.repository';
import {
  CreateMappingCommand,
  CreateMappingHandler,
} from './commands/mapping.commands';
import {
  GetMappingUsageHandler,
  GetMappingUsageQuery,
  ListMappingsHandler,
  ListMappingsQuery,
} from './queries/mapping.queries';

/** The engine's synthetic example mapping — never real data. */
const spec = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        `../../../../../libs/engine/src/mapping/fixtures/${name}.mapping.json`,
      ),
      'utf8',
    ),
  );

async function setup() {
  const projects = new InMemoryProjectRepository();
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const base = { country: 'CH' as const, canton: 'ZH', notes: '' };
  const p2025 = await projects.create('anna', {
    ...base,
    name: 'Steuern 2025',
    taxYear: 2025,
  });
  const p2024 = await projects.create('anna', {
    ...base,
    name: 'Steuern 2024',
    taxYear: 2024,
  });
  const create = new CreateMappingHandler(mappings);
  const kraken = await create.execute(
    new CreateMappingCommand('anna', spec('kraken-ledger'), 'manual'),
  );
  const binance = await create.execute(
    new CreateMappingCommand('anna', spec('bitfinex-ledger'), 'ai'),
  );
  let seq = 0;
  /** A project file read with `mappingId` (or by none). */
  const addFile = async (
    projectId: string,
    displayName: string,
    mappingId: string | null,
  ) => {
    seq += 1;
    const result = await files.add({
      ownerId: 'anna',
      projectId,
      stored: {
        create: {
          sha256: seq.toString(16).padStart(64, '0'),
          bytes: new Uint8Array([seq]),
          mediaType: 'text/csv',
          kind: 'csv',
          originalName: displayName,
          source: 'uploaded',
          analysis: mappingId
            ? {
                ...NOT_ANALYSED,
                status: 'mapped',
                importerId: `mapping:${mappingId}`,
                mappingId,
              }
            : NOT_ANALYSED,
        },
      },
      displayName,
      origin: 'uploaded',
    });
    if (!('created' in result)) throw new Error('expected a new entry');
    return result.created;
  };
  return {
    projects,
    files,
    mappings,
    p2025,
    p2024,
    kraken,
    binance,
    addFile,
    list: new ListMappingsHandler(mappings, files),
    usage: new GetMappingUsageHandler(mappings, files, projects),
  };
}

describe('several .json at once (F11.0u): duplicates', () => {
  it('refuses a spec I already have only when asked (409 duplicateMapping); another user is not a duplicate', async () => {
    const t = await setup();
    const create = new CreateMappingHandler(t.mappings);
    const refused = await create
      .execute(
        new CreateMappingCommand('anna', spec('kraken-ledger'), 'copied', true),
      )
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toMatchObject({
      code: 'duplicateMapping',
      existingId: t.kraken.id,
    });
    // Key order and unknown keys do not make a spec different.
    const reordered = Object.fromEntries(
      Object.entries(
        spec('kraken-ledger') as Record<string, unknown>,
      ).reverse(),
    );
    await expect(
      create.execute(
        new CreateMappingCommand(
          'anna',
          { ...reordered, unknownKey: 1 },
          'copied',
          true,
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    // Without the flag (the editor) a second copy is fine, as before.
    await expect(
      create.execute(
        new CreateMappingCommand('anna', spec('kraken-ledger'), 'copied'),
      ),
    ).resolves.toMatchObject({ ownerId: 'anna' });
    await expect(
      create.execute(
        new CreateMappingCommand(
          'bruno',
          spec('kraken-ledger'),
          'copied',
          true,
        ),
      ),
    ).resolves.toMatchObject({ ownerId: 'bruno' });
  });
});

describe('the global mappings page (F11.0)', () => {
  it('lists my mappings across all projects with how many files and projects use them', async () => {
    const t = await setup();
    await t.addFile(t.p2025.id, 'ledgers-2025.csv', t.kraken.id);
    await t.addFile(t.p2025.id, 'ledgers-2025b.csv', t.kraken.id);
    await t.addFile(t.p2024.id, 'ledgers-2024.csv', t.kraken.id);
    await t.addFile(t.p2024.id, 'unknown.csv', null);
    await new CreateMappingHandler(t.mappings).execute(
      new CreateMappingCommand('bruno', spec('kraken-ledger'), 'manual'),
    );

    const listed = await t.list.execute(new ListMappingsQuery('anna'));
    expect(
      listed.map((entry) => [
        entry.mapping.id,
        entry.filesUsing,
        entry.projectsUsing,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [t.kraken.id, 3, 2],
        [t.binance.id, 0, 0],
      ]),
    );
    expect(listed).toHaveLength(2);
    expect(await t.list.execute(new ListMappingsQuery('carla'))).toEqual([]);
  });

  it('shows where a mapping is used: projects newest year first, files by name', async () => {
    const t = await setup();
    await t.addFile(t.p2024.id, 'b.csv', t.kraken.id);
    await t.addFile(t.p2025.id, 'z.csv', t.kraken.id);
    await t.addFile(t.p2025.id, 'a.csv', t.kraken.id);
    await t.addFile(t.p2025.id, 'other.csv', t.binance.id);
    await t.projects.update(t.p2024.id, { status: 'closed' });

    const usage = await t.usage.execute(
      new GetMappingUsageQuery('anna', t.kraken.id),
    );
    expect(
      usage.map((project) => ({
        name: project.name,
        status: project.status,
        files: project.files.map((file) => file.displayName),
      })),
    ).toEqual([
      {
        name: 'Steuern 2025',
        status: 'in_progress',
        files: ['a.csv', 'z.csv'],
      },
      { name: 'Steuern 2024', status: 'closed', files: ['b.csv'] },
    ]);
    expect(usage[0]?.files[0]).toMatchObject({ status: 'mapped' });
    expect(
      await t.usage.execute(new GetMappingUsageQuery('anna', t.binance.id)),
    ).toHaveLength(1);
  });

  it("answers someone else's mapping like a missing one (404)", async () => {
    const t = await setup();
    await expect(
      t.usage.execute(new GetMappingUsageQuery('bruno', t.kraken.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.usage.execute(new GetMappingUsageQuery('anna', 'missing')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
