import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { CreateProjectInput } from '../projects/domain/project';
import { toSqliteTimestamp } from './prisma/mappers/scalar.mapper';
import { PrismaService } from './prisma/prisma.service';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The claims a port double cannot prove: that the adapters' queries and the hand-written CHECK
 * constraints do what the handlers assume, against a real SQLite file with the real migrations.
 * Run with `pnpm ci:integration` (see CLAUDE.md, Testing) — never against your dev database:
 * scripts/dev/with-test-db.mjs sets DATABASE_URL to tmp/lazykoins-test.db first.
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

const INPUT: CreateProjectInput = {
  name: 'Steuern 2025',
  taxYear: 2025,
  country: 'CH',
  canton: 'ZH',
  notes: '',
};

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it:${name}:${Date.now()}:${seq}`,
      email: `${name}@it.dev`,
      emailVerified: true,
      name,
      signInProvider: 'dev',
    },
    name,
  );
}

/** A raw INSERT, bypassing the API's validation, to prove the database refuses it on its own. */
function insertRaw(ownerId: string, columns: Record<string, unknown>) {
  const row = {
    id: randomUUID(),
    owner_id: ownerId,
    name: 'Raw',
    tax_year: 2025,
    country: 'CH',
    canton: 'ZH',
    status: 'in_progress',
    notes: '',
    created_at: toSqliteTimestamp(new Date()),
    updated_at: toSqliteTimestamp(new Date()),
    ...columns,
  };
  const names = Object.keys(row);
  return prisma.$executeRawUnsafe(
    `INSERT INTO "project" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    ...Object.values(row),
  );
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('users', () => {
  it('creates once per identity uid and keeps the display name on the next sign-in', async () => {
    const identity = {
      uid: `it:once:${Date.now()}`,
      email: 'first@it.dev',
      emailVerified: true,
      name: 'First',
      signInProvider: 'google.com',
    };
    const created = await users.upsertFromIdentity(identity, 'First');
    const again = await users.upsertFromIdentity(
      { ...identity, email: 'changed@it.dev' },
      'Second',
    );

    expect(again.id).toBe(created.id);
    expect(again.displayName).toBe('First');
    expect(again.email).toBe('changed@it.dev');
    expect(await users.findPrincipalByIdentityUid(identity.uid)).toEqual({
      id: created.id,
    });
  });
});

describe('projects', () => {
  it('creates with defaults and lists only the owner’s, newest tax year first', async () => {
    const anna = await newUser('anna');
    const bruno = await newUser('bruno');
    const older = await projects.create(anna.id, { ...INPUT, taxYear: 2024 });
    const newer = await projects.create(anna.id, INPUT);
    await projects.create(bruno.id, INPUT);

    expect(newer).toMatchObject({ status: 'in_progress', ownerId: anna.id });
    expect((await projects.findByOwner(anna.id)).map((p) => p.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });

  it('updates only the given fields, and an empty update still finds the row', async () => {
    const owner = await newUser('upd');
    const project = await projects.create(owner.id, INPUT);

    const updated = await projects.update(project.id, {
      notes: 'Kraken fehlt',
      status: 'reviewed',
    });
    expect(updated).toMatchObject({
      name: 'Steuern 2025',
      notes: 'Kraken fehlt',
      status: 'reviewed',
    });
    // Regression (SQLite, from surf-lend): an updateMany without changed columns reported 0 rows.
    expect(await projects.update(project.id, {})).toMatchObject({
      id: project.id,
    });
    expect(await projects.update(randomUUID(), { name: 'x' })).toBeUndefined();
  });

  it('deletes, and reports whether there was something to delete', async () => {
    const owner = await newUser('del');
    const project = await projects.create(owner.id, INPUT);
    expect(await projects.delete(project.id)).toBe(true);
    expect(await projects.findById(project.id)).toBeUndefined();
    expect(await projects.delete(project.id)).toBe(false);
  });

  it('cascades a deleted account to its projects (F2.2)', async () => {
    const owner = await newUser('gone');
    const project = await projects.create(owner.id, INPUT);
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await prisma.user.delete({ where: { id: owner.id } });
    expect(await projects.findById(project.id)).toBeUndefined();
  });

  it('keeps the CHECK constraints of the init migration', async () => {
    const owner = await newUser('check');
    await expect(insertRaw(owner.id, {})).resolves.toBe(1);
    for (const bad of [
      { status: 'archived' },
      { country: 'DE' },
      { canton: 'ZUR' },
      { canton: 'zh' },
      { tax_year: 1999 },
      { name: '   ' },
    ]) {
      await expect(insertRaw(owner.id, bad)).rejects.toThrow(
        /CHECK constraint failed/,
      );
    }
  });
});
