import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PrismaService } from './prisma/prisma.service';
import { HintStatePrismaRepository } from './prisma/repositories/hint-state.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * `project_hint_state` (F5.8 dismissals) against a real SQLite file: upsert, reopen, cascade with
 * the project and the hand-written CHECKs. `pnpm ci:integration` — never your dev database.
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
const states = new HintStatePrismaRepository(prisma);

let seq = 0;
async function newProject() {
  seq += 1;
  const user = await users.upsertFromIdentity(
    {
      uid: `it-hints:${Date.now()}:${seq}`,
      email: `hints${seq}@it.dev`,
      emailVerified: true,
      name: 'Hints',
      signInProvider: 'dev',
    },
    'Hints',
  );
  return projects.create(user.id, {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('project hint state', () => {
  it('saves, replaces and removes a dismissal — and cascades with the project', async () => {
    const project = await newProject();
    await states.save(project.id, 'noYearEndBalance:kraken', {
      status: 'done',
      note: 'Konto nach 09.02. nicht mehr genutzt',
    });
    await states.save(project.id, 'noYearEndBalance:kraken', {
      status: 'ignored',
      note: '',
    });
    await states.save(project.id, 'endsEarly:binance|Spot', {
      status: 'done',
      note: '',
    });
    expect(
      (await states.listByProject(project.id)).map((s) => [
        s.hintKey,
        s.status,
        s.note,
      ]),
    ).toEqual([
      ['endsEarly:binance|Spot', 'done', ''],
      ['noYearEndBalance:kraken', 'ignored', ''],
    ]);

    await states.remove(project.id, 'endsEarly:binance|Spot');
    await states.remove(project.id, 'not-there');
    expect(await states.listByProject(project.id)).toHaveLength(1);

    await projects.delete(project.id);
    const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT COUNT(*) AS n FROM project_hint_state WHERE project_id = ?',
      project.id,
    );
    expect(Number(left[0]?.n)).toBe(0);
  });

  it('keeps the CHECK constraints of the hint migration', async () => {
    const project = await newProject();
    const insert = (key: string, status: string, note = '') =>
      prisma.$executeRawUnsafe(
        `INSERT INTO project_hint_state (project_id, hint_key, status, note, updated_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000+00:00')`,
        project.id,
        key,
        status,
        note,
      );
    await expect(insert('k1', 'open')).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert('', 'done')).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert('k2', 'done', 'x'.repeat(501))).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert('k3', 'ignored')).resolves.toBe(1);
  });
});
