import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import type { AppNotification } from '../api/notifications.types';
import { NotificationService } from '../notifications/notification.service';
import { NotificationBell } from './notification-bell';

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

const flushTasks = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

async function setup() {
  TestBed.configureTestingModule({
    imports: [NotificationBell],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
      {
        provide: NotificationService,
        useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
      },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('de-CH', {
    notifications: {
      bell: 'Benachrichtigungen',
      bellUnread: 'Benachrichtigungen, {{count}} ungelesen',
      heading: 'Benachrichtigungen',
      empty: 'Keine Benachrichtigungen',
      general: 'Allgemein',
      action: { toFile: 'Zur Datei' },
      title: { file: { needsMapping: 'Datei ohne Mapping: {{name}}' } },
    },
  });
  translate.use('de-CH');
  const fixture = TestBed.createComponent(NotificationBell);
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const answer = async (items: AppNotification[]) => {
    http
      .expectOne((r) => r.url === '/api/notifications')
      .flush({
        items,
        total: items.length,
        unread: items.filter((n) => n.readAt === null).length,
      });
    await flushTasks();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const bell = () => el.querySelector('button') as HTMLButtonElement;
  return { fixture, el, http, navigate, answer, bell };
}

describe('NotificationBell (F11.11)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the unread count and lists the notifications grouped by project', async () => {
    const t = await setup();
    t.bell().click();
    t.fixture.detectChanges();
    await t.answer([
      notification(),
      notification({ id: 'n2', projectId: null, projectName: null }),
    ]);
    expect(t.el.querySelector('[data-bell-badge]')?.textContent).toBe('2');
    expect(t.bell().getAttribute('aria-label')).toBe(
      'Benachrichtigungen, 2 ungelesen',
    );
    expect(t.bell().getAttribute('aria-expanded')).toBe('true');
    const items = t.el.querySelectorAll('[data-bell-item]');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Datei ohne Mapping: ledger.csv');
    expect(t.el.textContent).toContain('Steuern 2025');
    expect(t.el.textContent).toContain('Allgemein');
  });

  it('runs the action: marks it read, closes the panel and navigates', async () => {
    const t = await setup();
    t.bell().click();
    t.fixture.detectChanges();
    await t.answer([notification()]);
    const action = [...t.el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Zur Datei'),
    ) as HTMLButtonElement;
    action.click();
    await flushTasks();
    t.http.expectOne('/api/notifications/n1/read').flush({ unread: 0 });
    expect(t.navigate).toHaveBeenCalledWith(['/app/projects/p1'], {
      queryParams: { tab: 'files' },
      fragment: 'file-f1',
    });
    t.fixture.detectChanges();
    expect(t.el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the empty state and closes on Escape with the focus back on the bell', async () => {
    const t = await setup();
    t.bell().click();
    t.fixture.detectChanges();
    await t.answer([]);
    expect(t.el.querySelector('[data-bell-empty]')).not.toBeNull();
    expect(t.el.querySelector('[data-bell-badge]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    t.fixture.detectChanges();
    expect(t.el.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(t.bell());
  });
});
