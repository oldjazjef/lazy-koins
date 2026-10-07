import { provideAppHttpClient } from '../../../../core/data/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  ResultView,
  TransactionRow,
  TransactionsView,
} from '../../../../core/api/calculation.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';
import { transactionActions } from './project-transactions';
import { ProjectTransactionsService } from './project-transactions.service';

const row = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: 'f:2',
  timestamp: '2025-03-01T00:00:00.000Z',
  platform: 'kraken',
  accountId: 'spot',
  asset: 'DOT',
  quantity: '2',
  kind: 'income_staking',
  importedKind: null,
  fee: null,
  feeAsset: null,
  rawType: 'staking',
  note: null,
  group: null,
  sourceFileId: 'f',
  row: 2,
  manual: false,
  treatment: 'income',
  valueChf: '9',
  incomeCategory: 'staking',
  figureIds: ['inc:f:2'],
  correctionId: null,
  correctionReason: null,
  projectFileId: 'pf1',
  fileName: 'buchungen.csv',
  ...over,
});

const page = (
  rows: TransactionRow[],
  total = rows.length,
): TransactionsView => ({
  taxYear: 2025,
  currency: 'CHF',
  total,
  offset: 0,
  limit: 25,
  counts: {
    income: 1,
    oneOff: 0,
    balance: 0,
    checkOnly: 0,
    transfer: 0,
    spam: 0,
    unknown: 0,
    afterYear: 0,
    excluded: 0,
  },
  platforms: ['kraken'],
  rows,
});

const result: ResultView = {
  snapshot: null,
  stale: true,
  result: null,
  files: [],
};

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup() {
  TestBed.configureTestingModule({
    providers: [
      ProjectWorkspaceService,
      ProjectTransactionsService,
      provideAppHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      {
        provide: NotificationService,
        useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
      },
    ],
  });
  const workspace = TestBed.inject(ProjectWorkspaceService);
  const service = TestBed.inject(ProjectTransactionsService);
  const http = TestBed.inject(HttpTestingController);
  workspace.projectId.set('p1');
  workspace.tab.set('transactions');
  await settle();
  http.expectOne('/api/projects/p1/result').flush(result);
  return { workspace, service, http };
}

const transactionsRequest = (http: HttpTestingController) =>
  http.expectOne((r) => r.url === '/api/projects/p1/transactions');

describe('transactionActions (the row menu)', () => {
  const visible = (r: TransactionRow, closed = false) =>
    transactionActions(r, closed)
      .filter((a) => !a.hidden)
      .map((a) => a.id);

  it('offers deactivate, reclassify and the figure for a counted booking', () => {
    expect(visible(row())).toEqual([
      'aiFix',
      'figure',
      'reclassify',
      'exclude',
    ]);
  });

  it('offers "activate again" for a deactivated booking, nothing that changes on a closed project', () => {
    const excluded = row({
      treatment: 'excluded',
      correctionId: 'c1',
      figureIds: [],
    });
    expect(visible(excluded)).toEqual(['aiFix', 'reactivate']);
    expect(visible(excluded, true)).toEqual([]);
    expect(visible(row(), true)).toEqual(['figure']);
  });

  it('never deactivates a manual booking (undo its correction instead)', () => {
    expect(visible(row({ manual: true }))).toEqual(['aiFix', 'figure']);
  });
});

describe('ProjectTransactionsService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads a page with the filters as query parameters, server-side paging', async () => {
    const { service, http } = await setup();
    await settle();
    const first = transactionsRequest(http);
    expect(first.request.params.get('offset')).toBe('0');
    expect(first.request.params.get('limit')).toBe('25');
    first.flush(page([row()], 60));
    await settle();
    expect(service.pager.total()).toBe(60);
    expect(service.pager.pageCount()).toBe(3);

    service.pager.setPage(2);
    await settle();
    const third = transactionsRequest(http);
    expect(third.request.params.get('offset')).toBe('50');
    third.flush(page([row()], 60));
    await settle();

    service.treatment.set('income');
    service.query.set('dot');
    await settle();
    const filtered = transactionsRequest(http);
    expect(filtered.request.params.get('offset')).toBe('0');
    expect(filtered.request.params.get('treatment')).toBe('income');
    expect(filtered.request.params.get('q')).toBe('dot');
    filtered.flush(page([row()]));
    await settle();
  });

  it('deactivates with the reason as an exclude_booking correction, then recalculates', async () => {
    const { service, http } = await setup();
    await settle();
    transactionsRequest(http).flush(page([row()]));
    await settle();

    const done = service.exclude(row(), 'Doppelt importiert');
    await settle();
    const created = http.expectOne('/api/projects/p1/corrections');
    expect(created.request.body).toEqual({
      data: { type: 'exclude_booking', bookingId: 'f:2' },
      reason: 'Doppelt importiert',
    });
    created.flush({ id: 'c1' });
    await settle();
    http.expectOne('/api/projects/p1/calculate').flush(result);
    await done;
    await settle();
    // Every change refetches what is on screen.
    for (const r of http.match(() => true))
      r.flush(r.request.url.endsWith('/transactions') ? page([]) : result);
  });

  it('activates a deactivated booking again by undoing its correction', async () => {
    const { service, http } = await setup();
    await settle();
    transactionsRequest(http).flush(page([]));
    await settle();
    const done = service.reactivate(
      row({ treatment: 'excluded', correctionId: 'c1' }),
    );
    await settle();
    http.expectOne('/api/projects/p1/corrections/c1/undo').flush({ id: 'c1' });
    await settle();
    http.expectOne('/api/projects/p1/calculate').flush(result);
    await done;
    await settle();
    for (const r of http.match(() => true))
      r.flush(r.request.url.endsWith('/transactions') ? page([]) : result);
  });
});
