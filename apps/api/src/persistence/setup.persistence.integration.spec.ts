import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { hashPin, verifyPin } from '../pin/domain/pin-hash';
import { toSqliteTimestamp } from './prisma/mappers/scalar.mapper';
import { PrismaService } from './prisma/prisma.service';
import { SetupProgressPrismaRepository } from './prisma/repositories/setup-progress.prisma.repository';
import { UserPinPrismaRepository } from './prisma/repositories/user-pin.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The setup/PIN migration against a real SQLite file: the adapters of `setup_progress` and
 * `user_pin` (upsert, remove, cascade) and their CHECKs.
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
const progress = new SetupProgressPrismaRepository(prisma);
const pins = new UserPinPrismaRepository(prisma);

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it-setup:${name}:${Date.now()}:${seq}`,
      email: `${name}@it.dev`,
      emailVerified: true,
      name,
      signInProvider: 'dev',
    },
    name,
  );
}

function insert(table: string, row: Record<string, unknown>) {
  const names = Object.keys(row);
  return prisma.$executeRawUnsafe(
    `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    ...Object.values(row),
  );
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('setup_progress', () => {
  it('upserts the steps as JSON, keeps the current step, cascades with the account', async () => {
    const user = await newUser('setup-anna');
    expect(await progress.find(user.id)).toBeUndefined();
    await progress.save(user.id, {
      steps: { profile: 'done', ai: 'skipped' },
      currentStep: 'rates',
      completedAt: null,
    });
    const saved = await progress.save(user.id, {
      steps: { profile: 'done', ai: 'skipped', rates: 'error' },
      currentStep: 'summary',
      completedAt: '2026-10-07T10:00:00.000Z',
    });
    expect(saved).toMatchObject({
      steps: { profile: 'done', ai: 'skipped', rates: 'error' },
      currentStep: 'summary',
      completedAt: '2026-10-07T10:00:00.000Z',
    });
    expect(
      await prisma.setupProgress.count({ where: { userId: user.id } }),
    ).toBe(1);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await progress.find(user.id)).toBeUndefined();
  });

  it('refuses invalid JSON, a non-object and an unknown current step', async () => {
    const user = await newUser('setup-check');
    const now = toSqliteTimestamp(new Date());
    for (const bad of [
      { steps: 'not json' },
      { steps: '[1,2]' },
      { current_step: 'nonsense' },
    ]) {
      await expect(
        insert('setup_progress', { user_id: user.id, updated_at: now, ...bad }),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });
});

describe('user_pin', () => {
  it('stores only the scrypt hash, counts failures, removes and cascades', async () => {
    const user = await newUser('pin-anna');
    const pinHash = await hashPin('482913');
    await pins.save(user.id, {
      pinHash,
      failedAttempts: 0,
      nextAttemptAt: null,
      reloginRequiredAt: null,
      autoLockMinutes: 15,
    });
    const failed = await pins.save(user.id, {
      pinHash,
      failedAttempts: 3,
      nextAttemptAt: '2026-10-07T10:00:05.000Z',
      reloginRequiredAt: null,
      autoLockMinutes: 30,
    });
    expect(failed).toMatchObject({
      failedAttempts: 3,
      nextAttemptAt: '2026-10-07T10:00:05.000Z',
      autoLockMinutes: 30,
    });
    const row = await prisma.userPin.findUnique({
      where: { userId: user.id },
    });
    expect(JSON.stringify(row)).not.toContain('482913');
    expect(await verifyPin('482913', row?.pinHash ?? '')).toBe(true);
    expect(await pins.remove(user.id)).toBe(true);
    expect(await pins.remove(user.id)).toBe(false);

    await pins.save(user.id, {
      pinHash,
      failedAttempts: 0,
      nextAttemptAt: null,
      reloginRequiredAt: null,
      autoLockMinutes: 15,
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await pins.find(user.id)).toBeUndefined();
  });

  it('refuses a plain PIN, negative counters and auto-lock outside 1–240', async () => {
    const user = await newUser('pin-check');
    const now = toSqliteTimestamp(new Date());
    const row = (columns: Record<string, unknown>) => ({
      user_id: user.id,
      pin_hash: 'scrypt$15$8$1$c2FsdA==$aGFzaA==',
      updated_at: now,
      ...columns,
    });
    for (const bad of [
      { pin_hash: '1234' },
      { failed_attempts: -1 },
      { auto_lock_minutes: 0 },
      { auto_lock_minutes: 241 },
    ]) {
      await expect(insert('user_pin', row(bad))).rejects.toThrow(
        /CHECK constraint failed/,
      );
    }
    await expect(insert('user_pin', row({}))).resolves.toBe(1);
  });
});
