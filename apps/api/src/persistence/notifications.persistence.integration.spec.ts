import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { NotificationService } from '../notifications/application/notification.service';
import { PrismaService } from './prisma/prisma.service';
import { NotificationPrismaRepository } from './prisma/repositories/notification.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * `notification` (F11.11) against a real SQLite file: upsert by topic, list/count/read/dismiss
 * scoped to the owner, resolve by prefix, cascade with user and project, and the hand-written
 * CHECKs. `pnpm ci:integration` — never your dev database.
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
const repository = new NotificationPrismaRepository(prisma);
const service = new NotificationService(repository);

let seq = 0;
async function newUser() {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it-notifications:${Date.now()}:${seq}`,
      email: `notifications${seq}@it.dev`,
      emailVerified: true,
      name: 'Notifications',
      signInProvider: 'dev',
    },
    'Notifications',
  );
}

async function newProject(ownerId: string) {
  return projects.create(ownerId, {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
}

const page = {
  status: 'all' as const,
  includeResolved: true,
  offset: 0,
  limit: 50,
};

beforeAll(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('notification', () => {
  it('upserts by topic, lists with the project name, reads, resolves and dismisses — per owner', async () => {
    const anna = await newUser();
    const bert = await newUser();
    const project = await newProject(anna.id);
    const topic = `rates.fetchFailed:${project.id}`;
    await service.raise(anna.id, topic, {
      kind: 'error',
      projectId: project.id,
      params: { assets: ['BTC'], count: 1 },
      action: {
        labelKey: 'notifications.action.retry',
        route: `/app/projects/${project.id}`,
        query: { tab: 'rates' },
        named: 'retry:rates',
      },
    });
    await service.raise(anna.id, topic, {
      kind: 'error',
      projectId: project.id,
      params: { assets: ['BTC', 'ETH'], count: 2 },
    });
    await service.raise(anna.id, 'file.needsMapping:a', {
      kind: 'action',
      projectId: project.id,
    });
    await service.raise(anna.id, 'file.needsMapping:b', {
      kind: 'action',
      projectId: project.id,
    });

    const listed = await repository.list(anna.id, page);
    expect(listed.total).toBe(3);
    const failed = listed.items.find((n) => n.topic === topic);
    expect(failed).toMatchObject({
      projectName: 'Steuern 2025',
      titleKey: 'notifications.title.rates.fetchFailed',
      params: { assets: 'BTC, ETH', count: 2 },
      action: null,
      readAt: null,
    });
    expect(await repository.countUnread(anna.id)).toBe(3);
    expect((await repository.list(bert.id, page)).total).toBe(0);

    expect(
      await repository.markRead(
        bert.id,
        failed?.id ?? '',
        new Date().toISOString(),
      ),
    ).toBe(false);
    expect(
      await repository.markRead(
        anna.id,
        failed?.id ?? '',
        new Date().toISOString(),
      ),
    ).toBe(true);
    expect(await repository.countUnread(anna.id)).toBe(2);

    await service.resolveWhere(anna.id, {
      projectId: project.id,
      topicPrefix: 'file.needsMapping:',
      exceptTopics: ['file.needsMapping:b'],
    });
    const open = await repository.list(anna.id, {
      ...page,
      includeResolved: false,
    });
    expect(open.items.map((n) => n.topic).sort()).toEqual([
      'file.needsMapping:b',
      topic,
    ]);

    expect(
      await repository.dismiss(
        bert.id,
        open.items[0]?.id ?? '',
        new Date().toISOString(),
      ),
    ).toBe(false);
    await repository.dismiss(
      anna.id,
      open.items[0]?.id ?? '',
      new Date().toISOString(),
    );
    expect((await repository.list(anna.id, page)).total).toBe(2);
    expect(
      await repository.markAllRead(anna.id, new Date().toISOString()),
    ).toBeGreaterThanOrEqual(0);
    expect(await repository.countUnread(anna.id)).toBe(0);
    expect(
      await repository.hasErrorSince(
        anna.id,
        project.id,
        '2000-01-01T00:00:00Z',
      ),
    ).toBe(true);

    // Gone with the project; the user-level ones only with the user.
    await service.raise(anna.id, 'ai.callFailed', { kind: 'error' });
    await projects.delete(project.id);
    expect(
      (await repository.list(anna.id, page)).items.map((n) => n.topic),
    ).toEqual(['ai.callFailed']);
    await prisma.user.delete({ where: { id: anna.id } });
    const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT COUNT(*) AS n FROM notification WHERE user_id = ?',
      anna.id,
    );
    expect(Number(left[0]?.n)).toBe(0);
  });

  it('keeps the CHECK constraints of the notification migration', async () => {
    const user = await newUser();
    let id = 0;
    const insert = (
      over: Partial<{
        kind: string;
        topic: string;
        title: string;
        params: string;
        action: string | null;
      }>,
    ) => {
      id += 1;
      return prisma.$executeRawUnsafe(
        `INSERT INTO notification (id, user_id, kind, topic, title_key, params, action, created_at, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000+00:00', '2026-01-01T00:00:00.000+00:00')`,
        `00000000-0000-7000-8000-${String(Date.now() % 1e6).padStart(6, '0')}${String(id).padStart(6, '0')}`,
        user.id,
        over.kind ?? 'info',
        over.topic ?? `t.${id}`,
        over.title ?? 'notifications.title.t',
        over.params ?? '{}',
        over.action === undefined ? null : over.action,
      );
    };
    await expect(insert({ kind: 'warning' })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert({ topic: '' })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert({ title: 'free text' })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert({ params: '[1]' })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert({ params: 'not json' })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert({ action: '"x"' })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert({ topic: 'dup' })).resolves.toBe(1);
    await expect(insert({ topic: 'dup' })).rejects.toThrow(/UNIQUE/);
    await expect(
      insert({ action: '{"route":"/app","labelKey":"x"}' }),
    ).resolves.toBe(1);
  });
});
