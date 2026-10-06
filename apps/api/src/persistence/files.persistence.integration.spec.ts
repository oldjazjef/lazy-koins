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
      },
    },
    displayName: 'a.csv',
    origin: 'uploaded',
    analysis: ANALYSIS,
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
        },
      },
      displayName: 'b.csv',
      origin: 'uploaded',
      analysis: ANALYSIS,
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
      analysis: ANALYSIS,
    });
    expect(reused).toEqual({
      duplicate: expect.objectContaining({ id: first.id }),
    });
  });

  it('shares bytes between projects and deletes them with the last reference (F5.7)', async () => {
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
      analysis: ANALYSIS,
    });
    if (!('created' in second)) throw new Error('expected a new entry');
    expect(await files.firstOtherProjectUsing(first.fileId, p2.id)).toBe(p1.id);
    expect(await prisma.storedFile.count({ where: { id: first.fileId } })).toBe(
      1,
    );

    expect(await files.remove(first.id)).toEqual({ storedFileDeleted: false });
    expect(await files.readContent(first.fileId)).toBeDefined();
    expect(await files.remove(second.created.id)).toEqual({
      storedFileDeleted: true,
    });
    expect(await files.readContent(first.fileId)).toBeUndefined();
    expect(await files.remove(second.created.id)).toBeUndefined();
  });

  it('purges unreferenced bytes when a project is deleted, keeping shared ones', async () => {
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
      analysis: ANALYSIS,
    });
    expect(await projects.delete(p1.id)).toBe(true);
    expect(await files.readContent(only.fileId)).toBeUndefined();
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
        status: 'standard',
        coverage: '[]',
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
    for (const bad of [
      { status: 'unknown' },
      { status: 'mapped' },
      { origin: 'stolen' },
      { origin: 'from_project:' },
      { booking_count: -1 },
      { period_from: '2025-12-31', period_to: '2025-01-01' },
      { coverage: 'nope' },
      { display_name: '' },
    ]) {
      await expect(entry(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
    await expect(entry({ origin: `from_project:${project.id}` })).resolves.toBe(
      1,
    );
  });
});
