import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { ActivityService } from '../activity/activity.service';
import type { AppNotification } from '../api/notifications.types';
import { NotificationService } from '../notifications/notification.service';
import {
  NotificationCentreService,
  POLL_MS,
} from './notification-centre.service';

const notification = (
  over: Partial<AppNotification> = {},
): AppNotification => ({
  id: 'n1',
  projectId: 'p1',
  projectName: 'Steuern 2025',
  kind: 'action',
  topic: 'file.needsMapping:f1',
  titleKey: 'notifications.title.file.needsMapping',
  params: { name: 'ledger.csv' },
  action: {
    labelKey: 'notifications.action.toFile',
    route: '/app/projects/p1',
    query: { tab: 'files' },
    fragment: 'file-f1',
  },
  createdAt: '2026-10-08T08:00:00.000Z',
  occurredAt: '2026-10-08T08:00:00.000Z',
  readAt: null,
  resolvedAt: null,
  dismissedAt: null,
  ...over,
});

const LIST_URL = '/api/notifications';

function setup() {
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
      { provide: NotificationService, useValue: toasts },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('de-CH', {
    notifications: {
      title: {
        file: { needsMapping: 'Datei ohne Mapping: {{name}}' },
        task: { failed: 'Fehlgeschlagen: {{task}}' },
        export: { failed: 'Auszug: {{kind}}' },
      },
      reason: { auth: 'Anmeldung abgelehnt' },
      osBody: 'lazy-koins',
    },
    activity: { export: 'Auszug wird erstellt ({{kind}})' },
    exports: { kind: { simple_pdf: 'Einfach (PDF)' } },
  });
  translate.use('de-CH');
  const centre = TestBed.inject(NotificationCentreService);
  const http = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  return { centre, http, router, navigate, toasts };
}

/** Lets the promise chain reach the next request. */
const flushTasks = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function answerList(
  http: HttpTestingController,
  items: AppNotification[],
  unread = items.filter((n) => n.readAt === null).length,
) {
  const request = http.expectOne((r) => r.url === LIST_URL);
  expect(request.request.params.get('includeResolved')).toBe('true');
  request.flush({ items, total: items.length, unread });
}

describe('NotificationCentreService (F11.11)', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete window.lazykoinsDesktop;
    TestBed.resetTestingModule();
  });

  it('polls every minute while started and stops on stop()', async () => {
    vi.useFakeTimers();
    const { centre, http } = setup();
    centre.start();
    await flushTasks();
    answerList(http, [notification()]);
    await flushTasks();
    expect(centre.unread()).toBe(1);
    expect(centre.groups()[0]).toMatchObject({
      projectName: 'Steuern 2025',
      items: [{ title: 'Datei ohne Mapping: ledger.csv', unread: true }],
    });

    await vi.advanceTimersByTimeAsync(POLL_MS);
    answerList(http, [notification(), notification({ id: 'n2' })]);
    await flushTasks();
    expect(centre.unread()).toBe(2);

    centre.stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    http.expectNone((r) => r.url === LIST_URL);
  });

  it('marks one / all read and dismisses — the badge follows the server', async () => {
    const { centre, http } = setup();
    void centre.refresh();
    answerList(http, [notification(), notification({ id: 'n2' })]);
    await flushTasks();

    const read = centre.markRead(notification());
    const readRequest = http.expectOne('/api/notifications/n1/read');
    expect(readRequest.request.method).toBe('POST');
    readRequest.flush({ unread: 1 });
    await read;
    expect(centre.unread()).toBe(1);

    const dismissed = centre.dismiss(notification({ id: 'n2' }));
    http.expectOne('/api/notifications/n2/dismiss').flush({ unread: 0 });
    await dismissed;
    expect(centre.views().map((v) => v.notification.id)).toEqual(['n1']);

    const all = centre.markAllRead();
    http.expectOne('/api/notifications/read-all').flush({ unread: 0 });
    await all;
    expect(centre.unread()).toBe(0);
    expect(centre.views()[0]?.unread).toBe(false);
  });

  it('hides resolved ones unless "erledigte ausblenden" is off', async () => {
    const { centre, http } = setup();
    void centre.refresh();
    answerList(http, [
      notification(),
      notification({ id: 'n2', resolvedAt: '2026-10-08T09:00:00.000Z' }),
    ]);
    await flushTasks();
    centre.setHideResolved(true);
    expect(centre.views()).toHaveLength(1);
    centre.setHideResolved(false);
    expect(centre.views()).toHaveLength(2);
    expect(centre.views()[1]?.resolved).toBe(true);
  });

  it('opens an action: marks it read and navigates to its route', async () => {
    const { centre, http, navigate } = setup();
    await centre.open(notification());
    http.expectOne('/api/notifications/n1/read').flush({ unread: 0 });
    expect(navigate).toHaveBeenCalledWith(['/app/projects/p1'], {
      queryParams: { tab: 'files' },
      fragment: 'file-f1',
    });
  });

  it('"Erneut versuchen" for rates starts the refresh again', async () => {
    const { centre, http } = setup();
    await centre.open(
      notification({
        kind: 'error',
        readAt: '2026-10-08T08:00:00.000Z',
        action: {
          labelKey: 'notifications.action.retry',
          route: '/app/projects/p1',
          query: { tab: 'rates' },
          named: 'retry:rates',
        },
      }),
    );
    const refresh = http.expectOne('/api/projects/p1/rates/refresh');
    expect(refresh.request.method).toBe('POST');
    refresh.flush({ fx: 0, assets: [] });
  });

  it('translates codes in params (task label, export kind, failure reason)', () => {
    const { centre } = setup();
    expect(
      centre.text(
        notification({
          titleKey: 'notifications.title.task.failed',
          params: { task: 'activity.export', kind: 'PDF' },
        }),
      ),
    ).toBe('Fehlgeschlagen: Auszug wird erstellt (PDF)');
    expect(
      centre.text(
        notification({
          titleKey: 'notifications.title.export.failed',
          params: { kind: 'simple_pdf' },
        }),
      ),
    ).toBe('Auszug: Einfach (PDF)');
  });
});

describe('activity completions (F11.13)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reports a failure and a task finished after leaving its page — not one finished in place', async () => {
    const { centre, http, router } = setup();
    const activity = TestBed.inject(ActivityService);
    Object.defineProperty(router, 'url', {
      configurable: true,
      get: () => currentUrl,
    });
    let currentUrl =
      '/app/projects/0199a000-0000-7000-8000-000000000001?tab=exports';
    centre.start();
    await flushTasks();
    answerList(http, []);

    // Finished on the same page: no report, only a refresh.
    await activity.track('activity.export', Promise.resolve(1), {
      params: { kind: 'PDF' },
    });
    await flushTasks();
    http.expectNone('/api/notifications/activity');
    answerList(http, []);

    // Left the page meanwhile: reported with where it started.
    let finish!: (value: number) => void;
    const running = activity.track(
      'activity.export',
      new Promise<number>((resolve) => (finish = resolve)),
      { params: { kind: 'PDF' } },
    );
    currentUrl = '/app/dashboard';
    finish(1);
    await running;
    await flushTasks();
    const report = http.expectOne('/api/notifications/activity');
    expect(report.request.body).toEqual({
      label: 'activity.export',
      outcome: 'success',
      params: { kind: 'PDF' },
      projectId: '0199a000-0000-7000-8000-000000000001',
      route: '/app/projects/0199a000-0000-7000-8000-000000000001',
      query: { tab: 'exports' },
    });
    report.flush({ notified: true });
    await flushTasks();
    answerList(http, []);

    // A failure is always reported.
    await activity
      .track('activity.rates', Promise.reject(new Error('x')))
      .catch(() => undefined);
    await flushTasks();
    const failure = http.expectOne('/api/notifications/activity');
    expect(failure.request.body).toMatchObject({
      label: 'activity.rates',
      outcome: 'error',
    });
    failure.flush({ notified: true });
    centre.stop();
  });

  it('desktop: new errors become OS notifications, what was there at start does not', async () => {
    const show = vi.fn().mockResolvedValue(undefined);
    window.lazykoinsDesktop = {
      platform: 'win32',
      storage: {
        info: vi
          .fn()
          .mockResolvedValue({ conflictCopies: ['lazykoins-PC.db'] }),
      },
      notifications: { enabled: vi.fn(), setEnabled: vi.fn(), show },
    } as never;
    const { centre, http } = setup();
    centre.start();
    await flushTasks();
    const sync = http.expectOne('/api/notifications/sync-conflict');
    expect(sync.request.body).toEqual({ count: 1 });
    sync.flush(null);
    await flushTasks();
    answerList(http, [notification({ kind: 'error' })]);
    await flushTasks();
    expect(show).not.toHaveBeenCalled();

    void centre.refresh();
    answerList(http, [
      notification({ kind: 'error' }),
      notification({ id: 'n2', kind: 'error', projectName: 'Steuern 2025' }),
      notification({ id: 'n3', kind: 'info' }),
    ]);
    await flushTasks();
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith({
      kind: 'error',
      title: 'Datei ohne Mapping: ledger.csv',
      body: 'Steuern 2025',
    });
    centre.stop();
    delete window.lazykoinsDesktop;
  });
});
