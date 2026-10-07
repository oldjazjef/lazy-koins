import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import { type MappingSpec, validateMappingSpec } from '@lazykoins/engine';
import type { Env } from '../config/env';
import { toSqliteTimestamp } from './prisma/mappers/scalar.mapper';
import { PrismaService } from './prisma/prisma.service';
import { ImportMappingPrismaRepository } from './prisma/repositories/import-mapping.prisma.repository';
import { LibraryPrismaRepository } from './prisma/repositories/library.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The mapping library (F5.15–F5.17, migration 20261008200000_mapping_library) against a real
 * SQLite file: soft delete, one rating per user and entry, the trigger-maintained aggregate
 * (also when a rater's account goes), copies that outlive their entry, and the hand-written
 * CHECKs (library tables + the widened import_mapping origin). `pnpm ci:integration` — never
 * your dev database.
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
const library = new LibraryPrismaRepository(prisma);
const mappings = new ImportMappingPrismaRepository(prisma);

const SPEC: MappingSpec = (() => {
  const result = validateMappingSpec({
    format: 'lazy-koins-mapping',
    version: 1,
    name: 'Synthetic Library',
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
      uid: `it-library:${name}:${Date.now()}:${seq}`,
      email: `${name}${seq}@it.dev`,
      emailVerified: true,
      name,
      signInProvider: 'dev',
    },
    name,
  );
}

const publication = (spec: MappingSpec = SPEC) => ({
  authorName: 'Pseudo',
  sourceMappingId: null,
  description: 'Synthetic',
  spec,
});

beforeAll(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('library_mapping + library_rating', () => {
  it('publishes, versions, soft-deletes; deleted entries leave the active list but stay', async () => {
    const anna = await newUser('anna');
    const entry = await library.create(anna.id, publication());
    expect(entry).toMatchObject({
      authorId: anna.id,
      version: 1,
      ratingCount: 0,
      usageCount: 0,
      deletedAt: null,
      fingerprint: 'amount|coin|date',
    });
    const v2 = await library.publishVersion(entry.id, {
      ...publication({ ...SPEC, name: 'Synthetic v2' }),
      description: null,
    });
    expect(v2).toMatchObject({ version: 2, name: 'Synthetic v2' });
    expect(
      (await library.listActive()).some((item) => item.id === entry.id),
    ).toBe(true);
    expect(await library.softDelete(entry.id, new Date().toISOString())).toBe(
      true,
    );
    expect(await library.softDelete(entry.id, new Date().toISOString())).toBe(
      false,
    );
    expect(
      (await library.listActive()).some((item) => item.id === entry.id),
    ).toBe(false);
    expect((await library.findById(entry.id))?.deletedAt).not.toBeNull();
    expect(await library.publishVersion(entry.id, publication())).toBe(
      undefined,
    );
    // Deleted entries still count for the spam guard.
    expect(
      await library.countPublishedSince(
        anna.id,
        new Date(Date.now() - 60_000).toISOString(),
      ),
    ).toBe(1);
    expect(await library.lastAuthorName(anna.id)).toBe('Pseudo');
  });

  it('keeps one rating per user; the triggers keep count and sum — also on cascade', async () => {
    const anna = await newUser('anna');
    const bob = await newUser('bob');
    const carla = await newUser('carla');
    const entry = await library.create(anna.id, publication());
    await library.setRating(entry.id, bob.id, 4);
    expect(await library.setRating(entry.id, carla.id, 2)).toMatchObject({
      ratingCount: 2,
      ratingSum: 6,
    });
    expect(await library.setRating(entry.id, bob.id, 5)).toMatchObject({
      ratingCount: 2,
      ratingSum: 7,
    });
    expect(await library.ratingsBy(bob.id, [entry.id])).toEqual(
      new Map([[entry.id, 5]]),
    );
    // A second row for the same user and entry is refused by the primary key.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "library_rating" ("library_mapping_id", "user_id", "stars", "created_at", "updated_at") VALUES (?, ?, 3, ?, ?)`,
        entry.id,
        bob.id,
        toSqliteTimestamp(new Date()),
        toSqliteTimestamp(new Date()),
      ),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    // Carla's account goes: her rating cascades, the aggregate follows (trigger).
    await prisma.user.delete({ where: { id: carla.id } });
    expect(await library.findById(entry.id)).toMatchObject({
      ratingCount: 1,
      ratingSum: 5,
    });
    expect(await library.setRating(entry.id, bob.id, null)).toMatchObject({
      ratingCount: 0,
      ratingSum: 0,
    });
    await library.incrementUsage(entry.id);
    expect((await library.findById(entry.id))?.usageCount).toBe(1);
  });

  it('keeps a copy (import_mapping origin library) when the entry and its author go', async () => {
    const anna = await newUser('anna');
    const bob = await newUser('bob');
    const entry = await library.create(anna.id, publication());
    const copy = await mappings.create(bob.id, {
      spec: SPEC,
      origin: 'library',
      library: { id: entry.id, version: 1 },
    });
    expect(copy.library).toEqual({ id: entry.id, version: 1 });
    expect(await mappings.findByLibrary(bob.id, entry.id)).toHaveLength(1);
    // An update without a reference keeps it.
    const edited = await mappings.update(copy.id, {
      spec: { ...SPEC, name: 'Edited copy' },
      origin: 'library',
    });
    expect(edited?.library).toEqual({ id: entry.id, version: 1 });
    await library.softDelete(entry.id, new Date().toISOString());
    await prisma.user.delete({ where: { id: anna.id } });
    expect(await library.findById(entry.id)).toBeUndefined();
    expect(await mappings.findById(copy.id)).toMatchObject({
      ownerId: bob.id,
      name: 'Edited copy',
      origin: 'library',
    });
  });
});

describe('CHECK constraints of the mapping-library migration', () => {
  const now = toSqliteTimestamp(new Date());

  it('library_mapping', async () => {
    const anna = await newUser('anna');
    const entry = (columns: Record<string, unknown>) => {
      const row = {
        id: randomUUID(),
        author_id: anna.id,
        author_name: null,
        name: 'M',
        platform: 'p',
        description: null,
        spec: '{}',
        fingerprint: 'a',
        version: 1,
        rating_count: 0,
        rating_sum: 0,
        usage_count: 0,
        published_at: now,
        updated_at: now,
        // Not a real spec: kept out of the active library other suites read.
        deleted_at: now,
        ...columns,
      };
      const names = Object.keys(row);
      return prisma.$executeRawUnsafe(
        `INSERT INTO "library_mapping" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...Object.values(row),
      );
    };
    await expect(entry({})).resolves.toBe(1);
    await expect(entry({ rating_count: 2, rating_sum: 7 })).resolves.toBe(1);
    for (const bad of [
      { name: ' ' },
      { platform: '' },
      { author_name: ' ' },
      { author_name: 'x'.repeat(41) },
      { description: 'x'.repeat(1001) },
      { spec: '{nope' },
      { spec: '[]' },
      { spec: JSON.stringify({ big: 'x'.repeat(70_000) }) },
      { fingerprint: '' },
      { version: 0 },
      { rating_count: -1 },
      { rating_count: 1, rating_sum: 6 },
      { rating_count: 2, rating_sum: 1 },
      { usage_count: -1 },
    ]) {
      await expect(entry(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
  });

  it('library_rating', async () => {
    const anna = await newUser('anna');
    const bob = await newUser('bob');
    const target = await library.create(anna.id, publication());
    for (const stars of [0, 6]) {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "library_rating" ("library_mapping_id", "user_id", "stars", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?)`,
          target.id,
          bob.id,
          stars,
          now,
          now,
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });

  it('import_mapping: origin library needs its reference, others must not have one', async () => {
    const owner = await newUser('owner');
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
    await expect(
      mapping({ origin: 'library', library_id: 'x', library_version: 2 }),
    ).resolves.toBe(1);
    for (const bad of [
      { origin: 'library' },
      { origin: 'library', library_id: 'x' },
      { origin: 'library', library_id: 'x', library_version: 0 },
      { origin: 'manual', library_id: 'x', library_version: 1 },
      { origin: 'robot' },
    ]) {
      await expect(mapping(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
  });
});
