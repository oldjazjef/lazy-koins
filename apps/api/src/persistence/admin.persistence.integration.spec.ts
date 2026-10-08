import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import { type MappingSpec, validateMappingSpec } from '@lazykoins/engine';
import type { Env } from '../config/env';
import { PrismaService } from './prisma/prisma.service';
import { AdminPrismaRepository } from './prisma/repositories/admin.prisma.repository';
import { LibraryPrismaRepository } from './prisma/repositories/library.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * Platform admin (migration 20261010140000_platform_admin) against a real SQLite file: the
 * hand-written CHECKs, blocking, the admin role, last seen, deleting an account with everything
 * it owns, hidden library entries (gone for everyone) and the audit log. `pnpm ci:integration`.
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
const admin = new AdminPrismaRepository(prisma);
const library = new LibraryPrismaRepository(prisma);
const projects = new ProjectPrismaRepository(prisma);

const SPEC: MappingSpec = (() => {
  const result = validateMappingSpec({
    format: 'lazy-koins-mapping',
    version: 1,
    name: 'Synthetic Admin',
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
      uid: `it-admin:${name}:${Date.now()}:${seq}`,
      email: `${name}${seq}.${Date.now()}@it.dev`,
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

describe('platform admin persistence', () => {
  it('keeps the CHECKs: reasons only with a date, 1–500 characters, known audit actions', async () => {
    const user = await newUser('checks');
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "user" SET "blocked_reason" = 'x' WHERE "id" = ?`,
        user.id,
      ),
    ).rejects.toThrow(/CHECK/);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "user" SET "blocked_at" = '2026-10-10T00:00:00.000+00:00', "blocked_reason" = '   ' WHERE "id" = ?`,
        user.id,
      ),
    ).rejects.toThrow(/CHECK/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "admin_audit" ("id","actor_id","actor_email","action","target_type","target_id","target_label") VALUES ('a1','x','x','user.hack','user','y','z')`,
      ),
    ).rejects.toThrow(/CHECK/);
  });

  it('blocks, grants the role, records the last request and finds them by filter', async () => {
    const anna = await newUser('anna');
    expect(
      (await users.findPrincipalByIdentityUid('nobody'))?.blockedAt,
    ).toBeUndefined();
    await admin.setBlocked(anna.id, {
      atIso: '2026-10-10T08:00:00.000Z',
      reason: 'Missbrauch',
    });
    await users.grantPlatformAdmin(anna.id);
    await users.touchLastSeen(anna.id, '2026-10-10T09:00:00.000Z');
    const found = await admin.findUser(anna.id);
    expect(found).toMatchObject({
      blockedAt: '2026-10-10T08:00:00.000Z',
      blockedReason: 'Missbrauch',
      isPlatformAdmin: true,
      lastSeenAt: '2026-10-10T09:00:00.000Z',
      projects: 0,
    });
    const blocked = await admin.listUsers({
      query: anna.email,
      filter: 'blocked',
      offset: 0,
      limit: 10,
    });
    expect(blocked.items.map((u) => u.id)).toEqual([anna.id]);
    await admin.setBlocked(anna.id, null);
    expect((await admin.findUser(anna.id))?.blockedReason).toBeNull();
    const overview = await admin.overview('2026-01-01T00:00:00.000Z');
    expect(overview.users).toBeGreaterThan(0);
    expect(overview.databaseBytes).toBeGreaterThan(0);
  });

  it('deletes an account with everything it owns', async () => {
    const bea = await newUser('bea');
    const project = await projects.create(bea.id, {
      name: 'Steuern',
      taxYear: 2025,
      country: 'CH',
      canton: 'ZH',
      taxCurrency: 'CHF',
    } as never);
    const entry = await library.create(bea.id, {
      authorName: null,
      sourceMappingId: null,
      description: null,
      spec: SPEC,
    });
    expect((await admin.findUser(bea.id))?.projects).toBe(1);
    await admin.deleteUser(bea.id);
    expect(await admin.findUser(bea.id)).toBeUndefined();
    expect(await projects.findById(project.id)).toBeUndefined();
    expect(await library.findById(entry.id)).toBeUndefined();
  });

  it('hides a library entry for everyone and audits it', async () => {
    const carl = await newUser('carl');
    const entry = await library.create(carl.id, {
      authorName: 'carl',
      sourceMappingId: null,
      description: null,
      spec: { ...SPEC, name: `Hidden ${Date.now()}` },
    });
    await admin.setLibraryHidden(entry.id, {
      atIso: '2026-10-10T10:00:00.000Z',
      reason: 'IBAN in der Beschreibung',
    });
    expect((await library.listActive()).map((e) => e.id)).not.toContain(
      entry.id,
    );
    expect(await library.findActiveByAuthor(carl.id)).toEqual([]);
    expect((await library.findById(entry.id))?.hiddenReason).toBe(
      'IBAN in der Beschreibung',
    );
    const hidden = await admin.listLibrary({
      filter: 'hidden',
      query: carl.email,
      offset: 0,
      limit: 10,
    });
    expect(hidden.items).toMatchObject([
      { id: entry.id, authorEmail: carl.email },
    ]);
    const audit = await admin.addAudit({
      actorId: carl.id,
      actorEmail: carl.email,
      action: 'library.hide',
      targetType: 'library',
      targetId: entry.id,
      targetLabel: entry.name,
      reason: 'IBAN in der Beschreibung',
    });
    const log = await admin.listAudit(0, 200);
    expect(log.items.map((a) => a.id)).toContain(audit.id);
  });
});
