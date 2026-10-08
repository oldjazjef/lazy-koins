import { createHash, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import { validateMappingSpec, type MappingSpec } from '@lazykoins/engine';
import type { Env } from '../config/env';
import { type FileAnalysis, NOT_ANALYSED } from '../files/domain/project-file';
import { toSqliteTimestamp } from './prisma/mappers/scalar.mapper';
import { PrismaService } from './prisma/prisma.service';
import { ImportMappingPrismaRepository } from './prisma/repositories/import-mapping.prisma.repository';
import { ProjectFilePrismaRepository } from './prisma/repositories/project-file.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The file and mapping adapters against a real SQLite file with the real migrations: content
 * addressing per owner, the duplicate race, F5.7 deletion, mapping resets, cascades and the
 * hand-written CHECKs of the files migration. `pnpm ci:integration` — never your dev database.
 */
loadEnv({
  path: ['apps/api/.env.local', 'apps/api/.env', '.env'],
  quiet: true,
});

const config = {
  get: (key: string) =>
    key === 'DATABASE_URL' ? process.env['DATABASE_URL'] : undefined,
} as unknown as ConfigService<Env, true>;

const prisma = new PrismaService(config);
const users = new UserPrismaRepository(prisma);
const projects = new ProjectPrismaRepository(prisma);
const files = new ProjectFilePrismaRepository(prisma);
const mappings = new ImportMappingPrismaRepository(prisma);

const SPEC: MappingSpec = (() => {
  const result = validateMappingSpec({
    format: 'lazy-koins-mapping',
    version: 1,
    name: 'Synthetic',
    platform: 'synthetic',
    match: { headers: ['Date', 'Amount', 'Coin'] },
    bookings: {
      timestamp: { column: 'Date', format: 'ymd' },
      asset: { column: 'Coin' },
      quantity: { mode: 'signed', column: 'Amount' },
      kind: { columns: ['Type'], rules: [{ equals: ['Buy'], kind: 'trade' }] },
    },
  });
  if (!result.ok) throw new Error('fixture spec invalid');
  return result.spec;
})();

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it-files:${name}:${Date.now()}:${seq}`,
      email: `${name}@it.dev`,
      emailVerified: true,
      name,
      signInProvider: 'dev',
    },
    name,
  );
}

async function newProject(ownerId: string, name = 'Steuern 2025') {
  return projects.create(ownerId, {
    name,
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
}

function bytesOf(text: string) {
  const bytes = new TextEncoder().encode(text);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const ANALYSIS: FileAnalysis = {
  ...NOT_ANALYSED,
  status: 'standard',
  importerId: 'standard-v1',
  platform: 'kraken',
  period: { from: '2025-01-01', to: '2025-12-31' },
  bookingCount: 3,
  coverage: [
    {
      platform: 'kraken',
      accountId: 'main',
      from: '2025-01-01',
      to: '2025-12-31',
      bookings: 3,
      holdingDates: [],
    },
  ],
};

async function addNew(ownerId: string, projectId: string, text: string) {
  const { bytes, sha256 } = bytesOf(text);
  const result = await files.add({
    ownerId,
    projectId,
    stored: {
      create: {
        sha256,
        bytes,
        mediaType: 'text/csv',
        kind: 'csv',
        originalName: 'a.csv',
        source: 'uploaded',
        analysis: ANALYSIS,
      },
    },
    displayName: 'a.csv',
    origin: 'uploaded',
  });
  if (!('created' in result)) throw new Error('expected a new entry');
  return result.created;
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('stored files and project files', () => {
  it('stores the bytes unchanged, per owner, and lists without loading them', async () => {
    const anna = await newUser('anna');
    const bruno = await newUser('bruno');
    const project = await newProject(anna.id);
    const text = `Date,Amount\n2025-01-01,0.000000000000000001\n${randomUUID()}\n`;
    const entry = await addNew(anna.id, project.id, text);

    expect(entry).toMatchObject({
      status: 'standard',
      bookingCount: 3,
      period: { from: '2025-01-01', to: '2025-12-31' },
      coverage: ANALYSIS.coverage,
      kind: 'csv',
      origin: 'uploaded',
    });
    const content = await files.readContent(entry.fileId);
    expect(new TextDecoder().decode(content?.bytes)).toBe(text);
    expect(
      await files.findStoredBySha(anna.id, bytesOf(text).sha256),
    ).toMatchObject({ id: entry.fileId });
    // Same bytes, other owner: not found — users never share a row.
    expect(
      await files.findStoredBySha(bruno.id, bytesOf(text).sha256),
    ).toBeUndefined();
    expect((await files.listByProject(project.id)).map((f) => f.id)).toEqual([
      entry.id,
    ]);
  });

  it('reports a concurrent duplicate instead of failing', async () => {
    const owner = await newUser('race');
    const project = await newProject(owner.id);
    const text = `race ${randomUUID()}`;
    const first = await addNew(owner.id, project.id, text);
    const { bytes, sha256 } = bytesOf(text);
    const again = await files.add({
      ownerId: owner.id,
      projectId: project.id,
      stored: {
        create: {
          sha256,
          bytes,
          mediaType: 'text/csv',
          kind: 'csv',
          originalName: 'b.csv',
          source: 'uploaded',
          analysis: ANALYSIS,
        },
      },
      displayName: 'b.csv',
      origin: 'uploaded',
    });
    expect(again).toEqual({
      duplicate: expect.objectContaining({ id: first.id }),
    });
    const reused = await files.add({
      ownerId: owner.id,
      projectId: project.id,
      stored: { existingId: first.fileId },
      displayName: 'c.csv',
      origin: 'uploaded',
    });
    expect(reused).toEqual({
      duplicate: expect.objectContaining({ id: first.id }),
    });
  });

  it('shares bytes between projects and keeps them when the last project lets go (F5.23)', async () => {
    const owner = await newUser('share');
    const p1 = await newProject(owner.id, 'P1');
    const p2 = await newProject(owner.id, 'P2');
    const first = await addNew(owner.id, p1.id, `share ${randomUUID()}`);
    const second = await files.add({
      ownerId: owner.id,
      projectId: p2.id,
      stored: { existingId: first.fileId },
      displayName: 'copy.csv',
      origin: `from_project:${p1.id}`,
    });
    if (!('created' in second)) throw new Error('expected a new entry');
    expect(await files.firstOtherProjectUsing(first.fileId, p2.id)).toBe(p1.id);
    expect(await prisma.storedFile.count({ where: { id: first.fileId } })).toBe(
      1,
    );

    expect(await files.remove(first.id)).toBe(true);
    expect(await files.readContent(first.fileId)).toBeDefined();
    expect(await files.remove(second.created.id)).toBe(true);
    // F5.23: the bytes stay among the user's files — only deleteStored removes them.
    expect(await files.readContent(first.fileId)).toBeDefined();
    expect(await files.remove(second.created.id)).toBe(false);
    expect((await files.findStored(first.fileId))?.usages).toEqual([]);
  });

  it('keeps the reading on the stored file, shared by every project (F5.21), and deletes with the entries (F5.23)', async () => {
    const owner = await newUser('global');
    const p1 = await newProject(owner.id, 'P1');
    const p2 = await newProject(owner.id, 'P2');
    const first = await addNew(owner.id, p1.id, `global ${randomUUID()}`);
    const second = await files.add({
      ownerId: owner.id,
      projectId: p2.id,
      stored: { existingId: first.fileId },
      displayName: 'copy.csv',
      origin: 'selected',
    });
    if (!('created' in second)) throw new Error('expected a new entry');
    await files.updateAnalysis(first.id, {
      ...ANALYSIS,
      status: 'evidence_only',
      bookingCount: 0,
      coverage: [],
    });
    expect(await files.findById(second.created.id)).toMatchObject({
      status: 'evidence_only',
      bookingCount: 0,
    });
    const listed = await files.listByOwner(owner.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: first.fileId,
      status: 'evidence_only',
      source: 'uploaded',
      usages: [
        { projectFileId: first.id, projectId: p1.id, active: true },
        { projectFileId: second.created.id, projectId: p2.id, active: true },
      ],
    });
    const { bytes, sha256 } = bytesOf(`standalone ${randomUUID()}`);
    const standalone = await files.addStored(owner.id, {
      sha256,
      bytes,
      mediaType: 'text/csv',
      kind: 'csv',
      originalName: 'solo.csv',
      source: 'uploaded',
      analysis: ANALYSIS,
    });
    if (!('created' in standalone)) throw new Error('expected a new file');
    expect(standalone.created.usages).toEqual([]);
    expect(
      await files.addStored(owner.id, {
        sha256,
        bytes,
        mediaType: 'text/csv',
        kind: 'csv',
        originalName: 'again.csv',
        source: 'uploaded',
        analysis: ANALYSIS,
      }),
    ).toEqual({
      duplicate: expect.objectContaining({ id: standalone.created.id }),
    });
    expect(await files.deleteStored(first.fileId)).toBe(true);
    expect(await files.listByProject(p1.id)).toEqual([]);
    expect(await files.listByProject(p2.id)).toEqual([]);
    expect(await files.deleteStored(first.fileId)).toBe(false);
  });

  it('deactivates one project entry and activates it again (F5.7a)', async () => {
    const owner = await newUser('disable');
    const p1 = await newProject(owner.id, 'P1');
    const p2 = await newProject(owner.id, 'P2');
    const first = await addNew(owner.id, p1.id, `disable ${randomUUID()}`);
    const second = await files.add({
      ownerId: owner.id,
      projectId: p2.id,
      stored: { existingId: first.fileId },
      displayName: 'copy.csv',
      origin: `from_project:${p1.id}`,
    });
    if (!('created' in second)) throw new Error('expected a new entry');
    expect(first).toMatchObject({ disabledAt: null, disabledNote: null });

    const at = '2026-02-01T10:00:00.000Z';
    const off = await files.setDeactivation(first.id, { at, note: 'doppelt' });
    expect(off).toMatchObject({
      disabledAt: at,
      disabledNote: 'doppelt',
      status: 'standard',
    });
    expect((await files.listByProject(p1.id))[0]?.disabledAt).toBe(at);
    // The same stored file in the other project is unaffected.
    expect((await files.findById(second.created.id))?.disabledAt).toBeNull();

    const on = await files.setDeactivation(first.id, null);
    expect(on).toMatchObject({ disabledAt: null, disabledNote: null });
    expect(await files.setDeactivation(randomUUID(), null)).toBeUndefined();
  });

  it('keeps every file when a project is deleted (F5.23: files are global)', async () => {
    const owner = await newUser('purge');
    const p1 = await newProject(owner.id, 'P1');
    const p2 = await newProject(owner.id, 'P2');
    const only = await addNew(owner.id, p1.id, `only ${randomUUID()}`);
    const shared = await addNew(owner.id, p1.id, `shared ${randomUUID()}`);
    await files.add({
      ownerId: owner.id,
      projectId: p2.id,
      stored: { existingId: shared.fileId },
      displayName: 'shared.csv',
      origin: `from_project:${p1.id}`,
    });
    expect(await projects.delete(p1.id)).toBe(true);
    expect(await files.readContent(only.fileId)).toBeDefined();
    expect(await files.readContent(shared.fileId)).toBeDefined();
    expect(await projects.delete(p1.id)).toBe(false);
  });

  it('cascades a deleted account to its bytes, files and mappings (F2.2)', async () => {
    const owner = await newUser('gone');
    const project = await newProject(owner.id);
    const entry = await addNew(owner.id, project.id, `gone ${randomUUID()}`);
    const mapping = await mappings.create(owner.id, {
      spec: SPEC,
      origin: 'manual',
    });
    await prisma.user.delete({ where: { id: owner.id } });
    expect(await files.findById(entry.id)).toBeUndefined();
    expect(await files.readContent(entry.fileId)).toBeUndefined();
    expect(await mappings.findById(mapping.id)).toBeUndefined();
  });
});

describe('import mappings', () => {
  it('stores the spec with fingerprint, updates it, and resets its files on delete', async () => {
    const owner = await newUser('mapper');
    const project = await newProject(owner.id);
    const mapping = await mappings.create(owner.id, {
      spec: SPEC,
      origin: 'copied',
    });
    expect(mapping).toMatchObject({
      name: 'Synthetic',
      platform: 'synthetic',
      fingerprint: 'amount|coin|date',
      version: 1,
      origin: 'copied',
      spec: SPEC,
    });
    const entry = await addNew(owner.id, project.id, `mapped ${randomUUID()}`);
    await files.updateAnalysis(entry.id, {
      ...ANALYSIS,
      status: 'mapped',
      importerId: `mapping:${mapping.id}`,
      mappingId: mapping.id,
    });
    expect((await files.listByMapping(mapping.id)).map((f) => f.id)).toEqual([
      entry.id,
    ]);

    const updated = await mappings.update(mapping.id, {
      spec: { ...SPEC, name: 'Renamed', platform: 'other' },
      origin: 'copied',
    });
    expect(updated).toMatchObject({ name: 'Renamed', platform: 'other' });
    expect(await mappings.findByOwner(owner.id)).toHaveLength(1);

    expect(await mappings.delete(mapping.id)).toBe(1);
    expect(await mappings.findById(mapping.id)).toBeUndefined();
    expect(await files.findById(entry.id)).toMatchObject({
      status: 'needs_mapping',
      mappingId: null,
      bookingCount: 0,
      coverage: [],
    });
  });
});

describe('mapping usage counts (F11.0)', () => {
  it('counts the files each mapping read, per project, in the database', async () => {
    const owner = await newUser('usage');
    const p1 = await newProject(owner.id, 'Steuern 2025');
    const p2 = await newProject(owner.id, 'Steuern 2024');
    const used = await mappings.create(owner.id, {
      spec: SPEC,
      origin: 'manual',
    });
    const unused = await mappings.create(owner.id, {
      spec: { ...SPEC, name: 'Unused' },
      origin: 'manual',
    });
    const mapped = { ...ANALYSIS, status: 'mapped' as const };
    for (const [projectId, text] of [
      [p1.id, 'u1'],
      [p1.id, 'u2'],
      [p2.id, 'u3'],
    ] as const) {
      const entry = await addNew(
        owner.id,
        projectId,
        `${text} ${randomUUID()}`,
      );
      await files.updateAnalysis(entry.id, {
        ...mapped,
        importerId: `mapping:${used.id}`,
        mappingId: used.id,
      });
    }
    await addNew(owner.id, p2.id, `not mapped ${randomUUID()}`);

    const counts = await files.countByMappings([used.id, unused.id]);
    expect(counts).toEqual(
      [
        { mappingId: used.id, projectId: p1.id, files: 2 },
        { mappingId: used.id, projectId: p2.id, files: 1 },
      ].sort((a, b) => a.projectId.localeCompare(b.projectId)),
    );
    expect(await files.countByMappings([unused.id])).toEqual([]);
    expect(await files.countByMappings([])).toEqual([]);
  });
});

describe('CHECK constraints of the files migration', () => {
  it('refuses bad stored files, mappings and project files', async () => {
    const owner = await newUser('checks');
    const project = await newProject(owner.id);
    const now = toSqliteTimestamp(new Date());
    const stored = (columns: Record<string, unknown>) => {
      const row = {
        id: randomUUID(),
        owner_id: owner.id,
        sha256: createHash('sha256').update(randomUUID()).digest('hex'),
        bytes: Buffer.from('abc'),
        size: 3,
        media_type: 'text/csv',
        kind: 'csv',
        original_name: 'a.csv',
        created_at: now,
        ...columns,
      };
      const names = Object.keys(row);
      return prisma.$executeRawUnsafe(
        `INSERT INTO "stored_file" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...Object.values(row),
      );
    };
    const goodId = randomUUID();
    await expect(stored({ id: goodId })).resolves.toBe(1);
    for (const bad of [
      { sha256: 'ABC' },
      { sha256: 'G'.repeat(64) },
      { kind: 'png' },
      { size: 4 },
      { size: 0, bytes: Buffer.alloc(0) },
      { original_name: '  ' },
    ]) {
      await expect(stored(bad)).rejects.toThrow(/CHECK constraint failed/);
    }

    const mapping = (columns: Record<string, unknown>) => {
      const row = {
        id: randomUUID(),
        owner_id: owner.id,
        name: 'M',
        platform: 'p',
        spec: '{}',
        fingerprint: 'a',
        version: 1,
        origin: 'manual',
        created_at: now,
        updated_at: now,
        ...columns,
      };
      const names = Object.keys(row);
      return prisma.$executeRawUnsafe(
        `INSERT INTO "import_mapping" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...Object.values(row),
      );
    };
    await expect(mapping({})).resolves.toBe(1);
    for (const bad of [
      { origin: 'robot' },
      { version: 0 },
      { name: ' ' },
      { spec: '{nope' },
    ]) {
      await expect(mapping(bad)).rejects.toThrow(/CHECK constraint failed/);
    }

    const entry = (columns: Record<string, unknown>) => {
      const row = {
        id: randomUUID(),
        project_id: project.id,
        file_id: goodId,
        display_name: 'a.csv',
        origin: 'uploaded',
        added_at: now,
        ...columns,
      };
      const names = Object.keys(row);
      return prisma.$executeRawUnsafe(
        `INSERT INTO "project_file" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...Object.values(row),
      );
    };
    // F5.21: the reading lives on the stored file — its CHECKs moved there.
    for (const bad of [
      { status: 'unknown' },
      { status: 'mapped' },
      { booking_count: -1 },
      { period_from: '2025-12-31', period_to: '2025-01-01' },
      { coverage: 'nope' },
      { source: 'stolen' },
      { source: 'wallet:' },
    ]) {
      const sets = Object.keys(bad)
        .map((n) => `"${n}" = ?`)
        .join(', ');
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "stored_file" SET ${sets} WHERE "id" = ?`,
          ...Object.values(bad),
          goodId,
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
    for (const bad of [
      { origin: 'stolen' },
      { origin: 'from_project:' },
      { display_name: '' },
      // F5.7a: a note only with a deactivation, at most 500 characters.
      { disabled_note: 'ohne Datum' },
      { disabled_at: now, disabled_note: 'x'.repeat(501) },
    ]) {
      await expect(entry(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
    await expect(
      entry({
        origin: `from_project:${project.id}`,
        disabled_at: now,
        disabled_note: 'x'.repeat(500),
      }),
    ).resolves.toBe(1);
  });
});
