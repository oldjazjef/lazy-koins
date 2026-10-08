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
  key: 'f:2',
  status: 'original',
  hidden: false,
  linkedKey: null,
  editReason: null,
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

  it('offers details, reclassify, link, hide and the figure for a counted booking', () => {
    expect(visible(row())).toEqual([
      'detail',
      'aiFix',
      'figure',
      'reclassify',
      'link',
      'exclude',
    ]);
  });

  it('offers "show again" for a hidden booking, nothing that changes on a closed project', () => {
    const hidden = row({
      treatment: 'excluded',
      hidden: true,
      status: 'changed',
      figureIds: [],
    });
    expect(visible(hidden)).toEqual(['detail', 'aiFix', 'reactivate']);
    expect(visible(hidden, true)).toEqual(['detail']);
    expect(visible(row(), true)).toEqual(['detail', 'figure']);
  });

  it('never edits a manual booking (it is a correction: no key)', () => {
    expect(visible(row({ manual: true, key: null }))).toEqual([
      'aiFix',
      'figure',
    ]);
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

  it('asks for earlier bookings only on request (F9.6)', async () => {
    const { service, http } = await setup();
    await settle();
    expect(transactionsRequest(http).request.params.get('scope')).toBeNull();
    service.scope.set('all');
    await settle();
    const all = transactionsRequest(http);
    expect(all.request.params.get('scope')).toBe('all');
    all.flush(page([]));
    await settle();
  });
});
