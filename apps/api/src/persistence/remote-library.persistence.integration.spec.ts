import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import { type MappingSpec, validateMappingSpec } from '@lazykoins/engine';
import type { Env } from '../config/env';
import { toSqliteTimestamp } from './prisma/mappers/scalar.mapper';
import { PrismaService } from './prisma/prisma.service';
import { ImportMappingPrismaRepository } from './prisma/repositories/import-mapping.prisma.repository';
import { RemoteLibrarySettingsPrismaRepository } from './prisma/repositories/remote-library-settings.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * F5.18 (migration 20261008210000_remote_library) against a real SQLite file: the desktop's
 * link settings (one row per user, cascade, the hand-written CHECKs) and the source server of a
 * copy (`import_mapping.library_server`). `pnpm ci:integration` — never your dev database.
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
const settings = new RemoteLibrarySettingsPrismaRepository(prisma);
const mappings = new ImportMappingPrismaRepository(prisma);
const now = toSqliteTimestamp(new Date('2026-10-08T10:00:00.000Z'));

const SPEC: MappingSpec = (() => {
  const result = validateMappingSpec({
    format: 'lazy-koins-mapping',
    version: 1,
    name: 'Synthetic Remote',
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
      uid: `it-remote-library:${name}:${Date.now()}:${seq}`,
      email: `${name}${seq}@it.dev`,
      emailVerified: true,
      name,
      signInProvider: 'dev',
    },
    name,
  );
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('remote_library_settings', () => {
  it('stores, updates and cascades with the user', async () => {
    const owner = await newUser('owner');
    expect(await settings.find(owner.id)).toBeNull();
    const saved = await settings.save(owner.id, {
      url: 'https://lazykoins.example.ch',
      enabled: true,
      suggestions: false,
    });
    expect(saved).toMatchObject({
      userId: owner.id,
      url: 'https://lazykoins.example.ch',
      enabled: true,
      suggestions: false,
    });
    expect(
      await settings.save(owner.id, {
        url: '',
        enabled: false,
        suggestions: true,
      }),
    ).toMatchObject({ url: '', enabled: false, suggestions: true });
    await prisma.user.delete({ where: { id: owner.id } });
    expect(await settings.find(owner.id)).toBeNull();
  });

  it('CHECKs: an address only https / http, no trailing slash, query or fragment; on needs one', async () => {
    const owner = await newUser('owner');
    const row = (columns: Record<string, unknown>) => {
      const values = { user_id: owner.id, updated_at: now, ...columns };
      const names = Object.keys(values);
      return prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO "remote_library_settings" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...Object.values(values),
      );
    };
    await expect(row({ url: '' })).resolves.toBe(1);
    await expect(
      row({ url: 'http://localhost:3341', enabled: 1 }),
    ).resolves.toBe(1);
    for (const bad of [
      { url: 'ftp://example.ch' },
      { url: 'https://' },
      { url: 'https://example.ch/' },
      { url: 'https://example.ch/?a=1' },
      { url: 'https://example.ch/#x' },
      { url: `https://example.ch/${'a'.repeat(300)}` },
      { url: '', enabled: 1 },
    ]) {
      await expect(row(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
  });
});

describe('import_mapping.library_server', () => {
  it('keeps the source server of a desktop copy; NULL = this deployment', async () => {
    const owner = await newUser('owner');
    const libraryId = randomUUID();
    const copy = await mappings.create(owner.id, {
      spec: SPEC,
      origin: 'library',
      library: {
        id: libraryId,
        version: 2,
        server: 'https://lazykoins.example.ch',
      },
    });
    expect(copy.library).toEqual({
      id: libraryId,
      version: 2,
      server: 'https://lazykoins.example.ch',
    });
    const local = await mappings.create(owner.id, {
      spec: SPEC,
      origin: 'library',
      library: { id: randomUUID(), version: 1 },
    });
    expect(local.library?.server).toBeUndefined();
    // An update without a reference keeps it, server included.
    const edited = await mappings.update(copy.id, {
      spec: { ...SPEC, name: 'Edited copy' },
      origin: 'library',
    });
    expect(edited?.library?.server).toBe('https://lazykoins.example.ch');
  });

  it('CHECK: a server only with a library reference, and only an http(s) address', async () => {
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
        origin: 'library',
        library_id: 'x',
        library_version: 1,
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
      mapping({ library_server: 'https://lazykoins.example.ch' }),
    ).resolves.toBe(1);
    for (const bad of [
      { library_server: 'ftp://x' },
      { library_server: `https://${'a'.repeat(300)}` },
      {
        origin: 'manual',
        library_id: null,
        library_version: null,
        library_server: 'https://lazykoins.example.ch',
      },
    ]) {
      await expect(mapping(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
  });
});
