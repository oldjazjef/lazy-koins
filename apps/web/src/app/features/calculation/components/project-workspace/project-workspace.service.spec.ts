import { provideAppHttpClient } from '../../../../core/data/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  ChecksView,
  OpenItem,
  ResultView,
} from '../../../../core/api/calculation.types';
import { ActivityService } from '../../../../core/activity/activity.service';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { correctionBody } from '../project-corrections/correction-form';
import { ProjectWorkspaceService } from './project-workspace.service';

const view = (wealthChf = '100.5'): ResultView => ({
  snapshot: {
    id: 's1',
    projectId: 'p1',
    inputHash: 'a'.repeat(64),
    engineVersion: 1,
    wealthChf,
    incomeChf: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  stale: false,
  result: null,
  files: [],
});

const item: OpenItem = {
  key: 'missingPrice:pos:kraken|main|XYZ',
  check: 'missingPrices',
  reason: 'positionWithoutPrice',
  light: 'yellow',
  platform: 'kraken',
  accountId: 'main',
  asset: 'XYZ',
  date: '2025-12-31',
  params: { quantity: '5' },
  impactChf: null,
  recordIds: ['f:2'],
  done: false,
  note: '',
};

const checks: ChecksView = {
  snapshot: null,
  checks: [],
  items: [item],
  comparison: null,
};

/** httpResource issues its request from an effect; a flushed response lands one task later. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ProjectWorkspaceService,
      provideAppHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(ProjectWorkspaceService);
  const http = TestBed.inject(HttpTestingController);
  service.projectId.set('p1');
  await settle();
  http.expectOne('/api/projects/p1/result').flush(view());
  await settle();
  return { service, http, notifications };
}

describe('ProjectWorkspaceService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the result, and each tab only when it is shown', async () => {
    const { service, http } = await setup();
    expect(service.result.value()?.snapshot?.wealthChf).toBe('100.5');
    service.tab.set('rates');
    await settle();
    http
      .expectOne('/api/projects/p1/rates')
      .flush({ taxYear: 2025, online: true, series: [], manual: [] });
    service.tab.set('exports');
    await settle();
    http.expectOne('/api/projects/p1/exports').flush([]);
    await settle();
    expect(service.exports.value()).toEqual([]);
  });

  it('recalculates and shows the new snapshot (F7.6)', async () => {
    const { service, http, notifications } = await setup();
    const done = service.calculate();
    await settle();
    const request = http.expectOne('/api/projects/p1/calculate');
    expect(request.request.method).toBe('POST');
    request.flush(view('200'));
    await done;
    // The calculation is reported (DataChanges): the result reloads — the old one stays on
    // screen meanwhile.
    await settle();
    expect(service.result.value()?.snapshot?.wealthChf).toBe('100.5');
    http.expectOne('/api/projects/p1/result').flush(view('200'));
    await settle();
    expect(service.result.value()?.snapshot?.wealthChf).toBe('200');
    expect(notifications.success).toHaveBeenCalledWith(
      'calculation.calculated',
    );
  });

  it('drills a figure down to its records (F7.5)', async () => {
    const { service, http } = await setup();
    const shown = service.showRecords('pos:kraken|main|BTC', 'kraken · BTC');
    const request = http.expectOne(
      (r) => r.url === '/api/projects/p1/result/records',
    );
    expect(request.request.params.get('figure')).toBe('pos:kraken|main|BTC');
    request.flush({ figureId: 'pos:kraken|main|BTC', total: 0, records: [] });
    await shown;
    expect(service.recordsOf()?.title).toBe('kraken · BTC');
    expect(service.records()?.total).toBe(0);
    service.closeRecords();
    expect(service.recordsOf()).toBeNull();
  });

  it('refreshes rates and reports a refusal with its reason (F11.3)', async () => {
    const { service, http, notifications } = await setup();
    const refused = service.refreshRates(false);
    const request = http.expectOne('/api/projects/p1/rates/refresh');
    expect(request.request.body).toEqual({ force: false });
    request.flush(
      {
        message: 'Rate lookups on the internet are switched off (settings)',
        code: 'offline',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await expect(refused).rejects.toBeDefined();
    // F11.2: the reason by its code, in the user's language.
    expect(notifications.error).toHaveBeenCalledWith('rates.refreshFailed', {
      key: 'errors.api.offline',
    });
  });

  it('ticks off an open item and starts a correction from a figure (F8.2, F9)', async () => {
    const { service, http } = await setup();
    service.tab.set('checks');
    await settle();
    http.expectOne('/api/projects/p1/checks').flush(checks);
    await settle();
    const saved = service.saveItem(item, { done: true });
    const patch = http.expectOne('/api/projects/p1/open-items');
    expect(patch.request.body).toEqual({
      key: item.key,
      done: true,
      note: undefined,
    });
    patch.flush({});
    await saved;
    await settle();
    http.expectOne('/api/projects/p1/checks').flush(checks);
    http.expectOne('/api/projects/p1/result').flush(view());

    service.startCorrection({
      type: 'price_override',
      values: { asset: 'XYZ', date: '2025-12-31' },
    });
    expect(service.tab()).toBe('corrections');
    expect(service.draft()?.values['asset']).toBe('XYZ');
    await settle();
    http.expectOne('/api/projects/p1/corrections').flush([]);
  });

  it('shows a rate refresh in the activity indicator with the progress it polls', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { service, http } = await setup();
      const activity = TestBed.inject(ActivityService);
      const refreshing = service.refreshRates(true);
      const request = http.expectOne('/api/projects/p1/rates/refresh');
      expect(activity.tasks().map((t) => t.label)).toEqual(['activity.rates']);
      expect(activity.tasks()[0]?.progress()).toBeNull();

      vi.advanceTimersByTime(1000);
      http
        .expectOne('/api/projects/p1/rates/refresh/status')
        .flush({ running: true, done: 12, total: 40, current: 'DOT' });
      await settle();
      expect(activity.tasks()[0]?.progress()).toEqual({ done: 12, total: 40 });

      request.flush({ fx: 0, assets: [] });
      await refreshing;
      expect(activity.count()).toBe(0);
      expect(service.refreshProgress()).toBeNull();
      // No polling after the request ended.
      vi.advanceTimersByTime(3000);
      http.expectNone('/api/projects/p1/rates/refresh/status');
      await settle();
      http.expectOne('/api/projects/p1/result').flush(view());
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the ESTV import and an export as activities; the export toast offers the download', async () => {
    const { service, http, notifications } = await setup();
    const activity = TestBed.inject(ActivityService);
    const imported = service.importKursliste(
      new File(['<xml/>'], 'kursliste.xml'),
    );
    expect(activity.tasks().map((t) => t.label)).toEqual(['activity.estv']);
    http
      .expectOne('/api/projects/p1/rates/estv')
      .flush({ imported: 3, skipped: 0 });
    await imported;
    expect(activity.count()).toBe(0);
    await settle();
    http.expectOne('/api/projects/p1/result').flush(view());

    const created = service.createExport('simple_pdf');
    expect(activity.tasks()[0]?.label).toBe('activity.export');
    http.expectOne('/api/projects/p1/exports').flush({
      id: 'e1',
      kind: 'simple_pdf',
      fileName: 'a.pdf',
    });
    await created;
    expect(activity.count()).toBe(0);
    expect(notifications.success).toHaveBeenCalledWith(
      'exports.created',
      expect.objectContaining({ labelKey: 'exports.download' }),
    );
    await settle();
    http.expectOne('/api/projects/p1/result').flush(view());
  });

  it('creates an export and downloads it', async () => {
    const { service, http } = await setup();
    const created = service.createExport('detailed_xlsx');
    const post = http.expectOne('/api/projects/p1/exports');
    expect(post.request.body).toEqual({ kind: 'detailed_xlsx' });
    post.flush({ id: 'e1' });
    await created;
    await settle();
    http.expectOne('/api/projects/p1/result').flush(view());
  });

  it('asks before a statement while open items exist, then creates it on confirm (F10.2a)', async () => {
    const { service, http } = await setup();
    const asked = service.requestExport('simple_pdf');
    http.expectOne('/api/projects/p1/checks').flush({
      ...checks,
      items: [item, { ...item, key: 'other', done: true }],
    });
    await asked;
    expect(service.pendingExport()).toEqual({
      kind: 'simple_pdf',
      openItems: 1,
    });
    http.expectNone('/api/projects/p1/exports');

    const confirmed = service.confirmExport();
    const post = http.expectOne('/api/projects/p1/exports');
    expect(post.request.body).toEqual({ kind: 'simple_pdf' });
    post.flush({ id: 'e1' });
    await confirmed;
    expect(service.pendingExport()).toBeNull();
    await settle();
    http.expectOne('/api/projects/p1/result').flush(view());
  });

  it('cancels or leads to the checks instead of creating the statement', async () => {
    const { service, http } = await setup();
    const asked = service.requestExport('detailed_xlsx');
    http.expectOne('/api/projects/p1/checks').flush(checks);
    await asked;
    service.cancelExport();
    expect(service.pendingExport()).toBeNull();

    const again = service.requestExport('detailed_pdf');
    http.expectOne('/api/projects/p1/checks').flush(checks);
    await again;
    service.showChecks();
    expect(service.pendingExport()).toBeNull();
    expect(service.tab()).toBe('checks');
    await settle();
    http.expectOne('/api/projects/p1/checks').flush(checks);
    http.expectNone('/api/projects/p1/exports');
  });

  it('creates a statement at once when every item is done, and the internal report always', async () => {
    const { service, http } = await setup();
    const clean = service.requestExport('simple_xlsx');
    http
      .expectOne('/api/projects/p1/checks')
      .flush({ ...checks, items: [{ ...item, done: true }] });
    await settle();
    http.expectOne('/api/projects/p1/exports').flush({ id: 'e1' });
    await clean;
    expect(service.pendingExport()).toBeNull();
    await settle();
    http.expectOne('/api/projects/p1/result').flush(view());

    const internal = service.requestExport('internal_report_pdf');
    http.expectNone('/api/projects/p1/checks');
    const post = http.expectOne('/api/projects/p1/exports');
    expect(post.request.body).toEqual({ kind: 'internal_report_pdf' });
    post.flush({ id: 'e2' });
    await internal;
    await settle();
    http.expectOne('/api/projects/p1/result').flush(view());
  });
});

describe('correction form → API body (F9)', () => {
  const base = {
    reason: 'ESTV-Kurs',
    asset: 'eth',
    date: '2025-12-31',
    priceChf: '2500.5',
    bookingId: '',
    kind: 'transfer',
    platform: '',
    accountId: 'main',
    timestamp: '',
    quantity: '',
    fee: '',
    evidence: '',
  };

  it('builds a price override and asks for a reason', () => {
    expect(correctionBody({ ...base, type: 'price_override' })).toEqual({
      ok: true,
      body: {
        reason: 'ESTV-Kurs',
        data: {
          type: 'price_override',
          asset: 'eth',
          date: '2025-12-31',
          priceChf: '2500.5',
        },
      },
    });
    expect(
      correctionBody({ ...base, type: 'price_override', reason: ' ' }),
    ).toEqual({ ok: false, error: 'corrections.errors.reason' });
    expect(
      correctionBody({ ...base, type: 'price_override', priceChf: '1,5' }),
    ).toEqual({ ok: false, error: 'corrections.errors.positive' });
  });

  it('builds a manual booking in UTC with signed quantity', () => {
    const result = correctionBody({
      ...base,
      type: 'manual_booking',
      platform: 'ledger',
      asset: 'BCH',
      timestamp: '2025-08-01T12:00',
      quantity: '-0.5',
      kind: 'loss',
    });
    expect(result).toEqual({
      ok: true,
      body: {
        reason: 'ESTV-Kurs',
        data: {
          type: 'manual_booking',
          booking: {
            platform: 'ledger',
            accountId: 'main',
            timestamp: '2025-08-01T12:00:00Z',
            asset: 'BCH',
            quantity: '-0.5',
            kind: 'loss',
            priceChf: '2500.5',
          },
        },
      },
    });
  });
});
