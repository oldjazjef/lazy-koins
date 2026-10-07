import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ActivityService } from '../../core/activity/activity.service';
import type { EstvStatus } from '../../core/api/calculation.types';
import { NotificationService } from '../../core/notifications/notification.service';
import { ESTV_POLL_MS, estvPercent, EstvService } from './estv.service';

const running: EstvStatus['running'] = {
  years: [2025],
  year: 2025,
  startedAt: '2026-04-10T06:00:00.000Z',
  progress: { phase: 'download', bytes: 25, totalBytes: 100, entries: 0 },
};

const status = (over: Partial<EstvStatus> = {}): EstvStatus => ({
  autoEnabled: true,
  online: true,
  running: null,
  lastCheckAt: null,
  years: [],
  ...over,
});

const year2025 = (
  outcome: 'updated' | 'current' | 'failed',
  error: string | null = null,
): EstvStatus['years'][number] => ({
  year: 2025,
  version: null,
  check: { checkedAt: '2026-04-10T06:00:05.000Z', outcome, error },
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

function configure() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  return { notifications, http: TestBed.inject(HttpTestingController) };
}

describe('EstvService (F7.4a)', () => {
  afterEach(() => {
    vi.useRealTimers();
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the status only when asked', async () => {
    const { http } = configure();
    const service = TestBed.inject(EstvService);
    await settle();
    http.expectNone('/api/rates/estv');
    service.load();
    await settle();
    http.expectOne('/api/rates/estv').flush(status());
    await settle();
    expect(service.status()?.autoEnabled).toBe(true);
    expect(service.loadFailed()).toBe(false);
  });

  it('starts the update, polls while it runs and reports a new version', async () => {
    const { http, notifications } = configure();
    const service = TestBed.inject(EstvService);
    const done = service.update(2025);
    await settle();
    const post = http.expectOne('/api/rates/estv/update');
    expect(post.request.body).toEqual({ year: 2025 });
    post.flush(status({ running }));
    await settle();
    expect(service.isBusy()).toBe(true);
    expect(service.percent()).toBe(25);
    // The app-wide activity indicator shows the run, its year, phase and percentage.
    const activity = TestBed.inject(ActivityService);
    const [task] = activity.tasks();
    expect(task?.label).toBe('activity.estvUpdate');
    expect(task?.params()['year']).toBe(2025);
    expect(task?.progress()).toEqual({ done: 25, total: 100, asPercent: true });
    await new Promise((resolve) => setTimeout(resolve, ESTV_POLL_MS + 50));
    http
      .expectOne('/api/rates/estv')
      .flush(status({ years: [year2025('updated')], lastCheckAt: 'x' }));
    const final = await done;
    expect(final.running).toBeNull();
    expect(notifications.success).toHaveBeenCalledWith('estv.updated');
    expect(service.isBusy()).toBe(false);
    expect(activity.count()).toBe(0);
  });

  it('shows the error of a failed check', async () => {
    const { http, notifications } = configure();
    const service = TestBed.inject(EstvService);
    const done = service.update();
    await settle();
    const post = http.expectOne('/api/rates/estv/update');
    expect(post.request.body).toEqual({});
    const failed = status({
      years: [year2025('failed', 'ICTax: nicht erreichbar')],
    });
    post.flush(failed);
    await done;
    expect(service.status()).toEqual(failed);
    expect(notifications.error).toHaveBeenCalledWith(
      'estv.checkFailed',
      'ICTax: nicht erreichbar',
    );
  });
});

describe('estvPercent', () => {
  it('computes the progress percentage only with a known total', () => {
    expect(estvPercent(null)).toBeNull();
    expect(estvPercent(running)).toBe(25);
    expect(
      estvPercent({
        ...running,
        progress: { ...running.progress, totalBytes: null },
      }),
    ).toBeNull();
  });
});
