import { NotFoundException } from '@nestjs/common';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import {
  REDACTED,
  sanitizeAction,
  sanitizeParams,
  Topics,
} from '../domain/notification';
import { InMemoryNotificationRepository } from '../testing/in-memory-notification.repository';
import { NotificationService } from './notification.service';
import {
  CountNotificationsHandler,
  CountNotificationsQuery,
  DismissNotificationCommand,
  DismissNotificationHandler,
  ListNotificationsHandler,
  ListNotificationsQuery,
  MarkAllNotificationsReadCommand,
  MarkAllNotificationsReadHandler,
  MarkNotificationReadCommand,
  MarkNotificationReadHandler,
  ReportActivityCommand,
  ReportActivityHandler,
  ReportSyncConflictCommand,
  ReportSyncConflictHandler,
} from './notifications.handlers';

function setup() {
  const repository = new InMemoryNotificationRepository();
  const service = new NotificationService(repository);
  let clock = Date.parse('2026-10-08T08:00:00.000Z');
  service.now = () => new Date(clock);
  const tick = (ms = 1000) => {
    clock += ms;
  };
  const projects = new InMemoryProjectRepository();
  const all = { status: 'all' as const, includeResolved: true };
  const page = { offset: 0, limit: 50 };
  return {
    repository,
    service,
    tick,
    projects,
    list: (
      userId: string,
      criteria: Partial<ListNotificationsQuery['criteria']> = {},
    ) =>
      new ListNotificationsHandler(repository).execute(
        new ListNotificationsQuery(userId, { ...all, ...page, ...criteria }),
      ),
    count: (userId: string) =>
      new CountNotificationsHandler(repository).execute(
        new CountNotificationsQuery(userId),
      ),
    read: new MarkNotificationReadHandler(repository, service),
    readAll: new MarkAllNotificationsReadHandler(repository, service),
    dismiss: new DismissNotificationHandler(repository, service),
    activity: new ReportActivityHandler(projects, repository, service),
    sync: new ReportSyncConflictHandler(service),
  };
}

describe('NotificationService (F11.11)', () => {
  it('keeps one notification per topic: a repeated event is news again', async () => {
    const t = setup();
    const topic = Topics.ratesFetchFailed('p1');
    await t.service.raise('anna', topic, {
      kind: 'error',
      projectId: 'p1',
      params: { assets: ['BTC'], count: 1 },
    });
    const first = t.repository.topic(topic);
    await t.read.execute(
      new MarkNotificationReadCommand('anna', first?.id ?? ''),
    );
    t.tick();
    await t.service.raise('anna', topic, {
      kind: 'error',
      projectId: 'p1',
      params: { assets: ['BTC', 'ETH'], count: 2 },
    });

    const rows = t.repository.all('anna');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first?.id,
      titleKey: 'notifications.title.rates.fetchFailed',
      params: { assets: 'BTC, ETH', count: 2 },
      readAt: null,
      createdAt: '2026-10-08T08:00:00.000Z',
      occurredAt: '2026-10-08T08:00:01.000Z',
    });
    expect(await t.count('anna')).toEqual({ unread: 1 });
  });

  it('a repeated condition with the same content stays read (and dismissed)', async () => {
    const t = setup();
    const topic = Topics.openItems('p1');
    const raise = (count: number) =>
      t.service.raise('anna', topic, {
        kind: 'action',
        projectId: 'p1',
        params: { count },
      });
    await raise(3);
    const id = t.repository.topic(topic)?.id ?? '';
    await t.read.execute(new MarkNotificationReadCommand('anna', id));
    t.tick();
    await raise(3);
    expect(t.repository.topic(topic)?.readAt).not.toBeNull();
    expect(t.repository.topic(topic)?.occurredAt).toBe(
      '2026-10-08T08:00:00.000Z',
    );

    await t.dismiss.execute(new DismissNotificationCommand('anna', id));
    await raise(3);
    expect(t.repository.topic(topic)?.dismissedAt).not.toBeNull();
    expect((await t.list('anna')).items).toHaveLength(0);

    // Changed content is news: back, unread.
    t.tick();
    await raise(4);
    expect(t.repository.topic(topic)).toMatchObject({
      readAt: null,
      dismissedAt: null,
      params: { count: 4 },
    });
  });

  it('resolves when the cause is gone and brings a returning cause back', async () => {
    const t = setup();
    const topic = Topics.fileNeedsMapping('pf1');
    const raise = () =>
      t.service.raise('anna', topic, {
        kind: 'action',
        projectId: 'p1',
        params: { name: 'ledger.csv' },
      });
    await raise();
    expect(await t.count('anna')).toEqual({ unread: 1 });
    expect(await t.service.resolve('anna', topic)).toBe(1);
    expect(await t.count('anna')).toEqual({ unread: 0 });
    // Hidden by default ("erledigte ausblenden"), listed on request.
    expect(
      (await t.list('anna', { includeResolved: false })).items,
    ).toHaveLength(0);
    expect((await t.list('anna')).items[0]?.resolvedAt).not.toBeNull();

    await raise();
    expect(t.repository.topic(topic)).toMatchObject({
      resolvedAt: null,
      readAt: null,
    });
  });

  it('resolves by prefix and project except the topics still true', async () => {
    const t = setup();
    for (const id of ['a', 'b', 'c']) {
      await t.service.raise('anna', Topics.fileNeedsMapping(id), {
        kind: 'action',
        projectId: 'p1',
      });
    }
    await t.service.raise('anna', Topics.fileNeedsMapping('x'), {
      kind: 'action',
      projectId: 'p2',
    });
    await t.service.resolveWhere('anna', {
      projectId: 'p1',
      topicPrefix: 'file.needsMapping:',
      exceptTopics: [Topics.fileNeedsMapping('b')],
    });
    expect(
      t.repository
        .all('anna')
        .filter((n) => n.resolvedAt === null)
        .map((n) => n.topic)
        .sort(),
    ).toEqual(['file.needsMapping:b', 'file.needsMapping:x']);
  });

  it('is owner-scoped: someone else’s notification is a 404', async () => {
    const t = setup();
    await t.service.raise('anna', Topics.aiCallFailed(), { kind: 'error' });
    await t.service.raise('bert', Topics.aiCallFailed(), { kind: 'error' });
    const annas = t.repository.topic(Topics.aiCallFailed(), 'anna');
    await expect(
      t.read.execute(new MarkNotificationReadCommand('bert', annas?.id ?? '')),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.dismiss.execute(
        new DismissNotificationCommand('bert', annas?.id ?? ''),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await t.list('bert')).items).toHaveLength(1);
    expect((await t.list('anna')).items[0]?.id).toBe(annas?.id);
    expect(
      await t.readAll.execute(new MarkAllNotificationsReadCommand('bert')),
    ).toEqual({ unread: 0 });
    expect(await t.count('anna')).toEqual({ unread: 1 });
  });

  it('lists newest first, paged and filtered by kind, project and status', async () => {
    const t = setup();
    await t.service.raise('anna', 'a.one', { kind: 'error', projectId: 'p1' });
    t.tick();
    await t.service.raise('anna', 'a.two', { kind: 'info', projectId: 'p2' });
    t.tick();
    await t.service.raise('anna', 'a.three', { kind: 'error' });
    const first = await t.list('anna', {});
    expect(first.items.map((n) => n.topic)).toEqual([
      'a.three',
      'a.two',
      'a.one',
    ]);
    expect(first).toMatchObject({ total: 3, unread: 3 });
    expect(first.items[0]).not.toHaveProperty('userId');
    const errors = await t.list('anna', { kind: 'error' });
    expect(errors.items.map((n) => n.topic)).toEqual(['a.three', 'a.one']);
    const paged = await new ListNotificationsHandler(t.repository).execute(
      new ListNotificationsQuery('anna', {
        status: 'all',
        includeResolved: false,
        offset: 1,
        limit: 1,
      }),
    );
    expect(paged.items.map((n) => n.topic)).toEqual(['a.two']);
    await t.read.execute(
      new MarkNotificationReadCommand(
        'anna',
        t.repository.topic('a.two')?.id ?? '',
      ),
    );
    const unread = await t.list('anna', { status: 'unread' });
    expect(unread.items.map((n) => n.topic)).toEqual(['a.three', 'a.one']);
  });

  it('never stores keys, passwords, tokens or seed phrases (F11.13)', async () => {
    const t = setup();
    await t.service.raise('anna', Topics.aiCallFailed(), {
      kind: 'error',
      params: {
        code: 'invalidKey',
        detail: 'Incorrect API key provided: sk-proj-abcdefghijklmnop',
        header: 'Bearer abcdefghijklmnopqrstuvwxyz',
        apiKey: 'Zx81kq0Pp3Lr6Vw9Ys2Tt5Uu8Ii1Oo4Ee',
        password: 'password=hunter22',
        seed: 'abandon ability able about above absent absorb abstract absurd abuse access accident',
        privateKey:
          '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
        'bad key': 'x',
        nested: { a: 1 },
        name: 'kraken-ledger-2025.csv',
      },
    });
    const stored = t.repository.topic(Topics.aiCallFailed());
    expect(stored?.params).toEqual({
      code: 'invalidKey',
      detail: REDACTED,
      header: REDACTED,
      apiKey: REDACTED,
      password: REDACTED,
      seed: REDACTED,
      privateKey: REDACTED,
      name: 'kraken-ledger-2025.csv',
    });
    expect(JSON.stringify(stored)).not.toMatch(/sk-proj|hunter|abandon|0x4c08/);
  });

  it('keeps only well-formed actions inside the app', () => {
    expect(
      sanitizeAction({
        labelKey: 'notifications.action.toHint',
        route: '/app/projects/p1',
        query: { tab: 'hints', 'bad key': 'x', evil: '<script>' },
        fragment: 'file-1',
        named: 'retry:rates',
      }),
    ).toEqual({
      labelKey: 'notifications.action.toHint',
      route: '/app/projects/p1',
      query: { tab: 'hints' },
      fragment: 'file-1',
      named: 'retry:rates',
    });
    expect(
      sanitizeAction({
        labelKey: 'notifications.action.show',
        route: 'https://evil.example/app',
      }),
    ).toBeNull();
    expect(
      sanitizeAction({
        labelKey: 'notifications.action.show',
        route: '/app/../login',
      }),
    ).toBeNull();
    expect(sanitizeParams({ count: Number.NaN, ok: true })).toEqual({
      count: null,
      ok: true,
    });
  });

  it('never throws into the operation that raised it', async () => {
    const t = setup();
    t.repository.findByTopic = () => Promise.reject(new Error('disk full'));
    await expect(
      t.service.raise('anna', 'x.y', { kind: 'info' }),
    ).resolves.toBeUndefined();
    t.repository.resolve = () => Promise.reject(new Error('disk full'));
    await expect(t.service.resolve('anna', 'x.y')).resolves.toBe(0);
  });

  it('prunes resolved and dismissed notifications after 30 days', async () => {
    const t = setup();
    await t.service.raise('anna', 'old.one', { kind: 'info' });
    await t.service.resolve('anna', 'old.one');
    await t.service.raise('anna', 'old.open', { kind: 'info' });
    t.tick(31 * 24 * 60 * 60 * 1000);
    await t.service.raise('anna', 'new.one', { kind: 'info' });
    expect(
      t.repository
        .all('anna')
        .map((n) => n.topic)
        .sort(),
    ).toEqual(['new.one', 'old.open']);
  });
});

describe('activity reports (F11.13)', () => {
  it('stores a finished task with its route and settles an earlier failure of it', async () => {
    const t = setup();
    const project = await t.projects.create('anna', {
      name: 'Steuern 2025',
      taxYear: 2025,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    await t.activity.execute(
      new ReportActivityCommand('anna', {
        label: 'activity.export',
        outcome: 'error',
        params: { kind: 'PDF' },
        projectId: project.id,
        route: `/app/projects/${project.id}`,
        query: { tab: 'exports' },
      }),
    );
    const failed = t.repository.topic(
      Topics.taskFailed('activity.export', project.id),
    );
    expect(failed).toMatchObject({
      kind: 'error',
      titleKey: 'notifications.title.task.failed',
      params: { kind: 'PDF', task: 'activity.export' },
      action: {
        labelKey: 'notifications.action.show',
        route: `/app/projects/${project.id}`,
        query: { tab: 'exports' },
      },
    });

    await t.activity.execute(
      new ReportActivityCommand('anna', {
        label: 'activity.export',
        outcome: 'success',
        params: { kind: 'PDF' },
        projectId: project.id,
      }),
    );
    expect(
      t.repository.topic(Topics.taskFailed('activity.export', project.id))
        ?.resolvedAt,
    ).not.toBeNull();
    expect(
      t.repository.topic(Topics.taskDone('activity.export', project.id)),
    ).toMatchObject({ kind: 'success', projectId: project.id });
  });

  it('skips a failure the server already reported, and refuses foreign projects', async () => {
    const t = setup();
    const project = await t.projects.create('anna', {
      name: 'Steuern 2025',
      taxYear: 2025,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    await t.service.raise('anna', Topics.exportFailed(project.id), {
      kind: 'error',
      projectId: project.id,
    });
    t.tick(30_000);
    expect(
      await t.activity.execute(
        new ReportActivityCommand('anna', {
          label: 'activity.export',
          outcome: 'error',
          projectId: project.id,
        }),
      ),
    ).toEqual({ notified: false });
    await expect(
      t.activity.execute(
        new ReportActivityCommand('bert', {
          label: 'activity.export',
          outcome: 'success',
          projectId: project.id,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await t.activity.execute(
        new ReportActivityCommand('anna', {
          label: 'not.an.activity',
          outcome: 'success',
        }),
      ),
    ).toEqual({ notified: false });
  });

  it('raises and resolves the desktop sync conflict (F3.4)', async () => {
    const t = setup();
    await t.sync.execute(new ReportSyncConflictCommand('anna', 2));
    expect(t.repository.topic(Topics.syncConflict())).toMatchObject({
      kind: 'action',
      params: { count: 2 },
      action: { route: '/app/settings/storage' },
    });
    await t.sync.execute(new ReportSyncConflictCommand('anna', 0));
    expect(
      t.repository.topic(Topics.syncConflict())?.resolvedAt,
    ).not.toBeNull();
  });
});
