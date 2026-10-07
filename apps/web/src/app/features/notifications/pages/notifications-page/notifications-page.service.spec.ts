import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { AppNotification } from '../../../../core/api/notifications.types';
import { dataChangesInterceptor } from '../../../../core/data/data-changes.interceptor';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { NotificationsPageService } from './notifications-page.service';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const row = (id: string): AppNotification => ({
  id,
  projectId: null,
  projectName: null,
  kind: 'error',
  topic: `t.${id}`,
  titleKey: 'notifications.title.ai.callFailed',
  params: { code: 'invalidKey' },
  action: null,
  createdAt: '2026-10-08T08:00:00.000Z',
  occurredAt: '2026-10-08T08:00:00.000Z',
  readAt: null,
  resolvedAt: null,
  dismissedAt: null,
});

function setup() {
  TestBed.configureTestingModule({
    providers: [
      // The app's DataChanges interceptor: the dismiss reports itself, the list follows.
      provideHttpClient(withInterceptors([dataChangesInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
      {
        provide: NotificationService,
        useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
      },
    ],
  });
  const service = TestBed.inject(NotificationsPageService);
  TestBed.runInInjectionContext(() => service.follow());
  return {
    service,
    http: TestBed.inject(HttpTestingController),
  };
}

describe('NotificationsPageService (F11.11)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads with the filters as query params and reloads after an action', async () => {
    const { service, http } = setup();
    await settle();
    http.match((r) => r.url === '/api/projects');
    const first = http.expectOne((r) => r.url === '/api/notifications');
    expect(first.request.params.get('status')).toBe('all');
    expect(first.request.params.get('includeResolved')).toBe('false');
    expect(first.request.params.get('kind')).toBeNull();
    first.flush({ items: [row('a')], total: 1, unread: 1 });
    await settle();
    expect(service.rows()).toHaveLength(1);

    service.kind.set('error');
    service.status.set('resolved');
    service.projectId.set('p1');
    await settle();
    const filtered = http.expectOne((r) => r.url === '/api/notifications');
    expect(filtered.request.params.get('kind')).toBe('error');
    expect(filtered.request.params.get('includeResolved')).toBe('true');
    expect(filtered.request.params.get('projectId')).toBe('p1');
    filtered.flush({ items: [], total: 0, unread: 0 });
    await settle();
    expect(service.rows()).toEqual([]);

    service.status.set('unread');
    await settle();
    const unread = http.expectOne((r) => r.url === '/api/notifications');
    expect(unread.request.params.get('status')).toBe('unread');
    unread.flush({ items: [row('b')], total: 1, unread: 1 });
    await settle();

    const dismissed = service.dismiss(row('b'));
    http.expectOne('/api/notifications/b/dismiss').flush({ unread: 0 });
    await dismissed;
    await settle();
    http
      .expectOne((r) => r.url === '/api/notifications')
      .flush({ items: [], total: 0, unread: 0 });
  });
});
