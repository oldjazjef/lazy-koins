import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  Transaction,
  TransactionsPage,
} from '../../../../core/api/transactions.types';
import { provideAppHttpClient } from '../../../../core/data/testing';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { counterCandidates } from '../../../../shared/transactions/transaction-link-dialog';
import {
  lockedProjectsOf,
  TransactionEditsService,
} from '../../../../shared/transactions/transaction-edits.service';
import { ledgerActions } from './transactions-page';
import { TransactionsPageService } from './transactions-page.service';

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  key: 'f:2',
  timestamp: '2025-03-01T10:00:00.000Z',
  platform: 'kraken',
  accountId: 'spot',
  kind: 'withdrawal',
  originalKind: null,
  asset: 'BTC',
  originalAsset: null,
  quantity: '-0.5',
  fee: null,
  feeAsset: null,
  value: '100.00',
  group: null,
  note: null,
  rawType: 'withdrawal',
  source: { fileId: 's1', fileName: 'kraken.csv', row: 2, walletId: null },
  status: 'original',
  hidden: false,
  linkedKey: null,
  suggestion: null,
  projects: [],
  lockedBy: [],
  ...over,
});

const page = (rows: Transaction[], total = rows.length): TransactionsPage => ({
  currency: 'CHF',
  total,
  offset: 0,
  limit: 25,
  rows,
  platforms: ['kraken'],
  accounts: ['spot'],
  assets: ['BTC'],
  unreadable: 0,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideAppHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      {
        provide: NotificationService,
        useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
      },
    ],
  });
  const service = TestBed.inject(TransactionsPageService);
  TestBed.runInInjectionContext(() => service.follow());
  return { service, http: TestBed.inject(HttpTestingController) };
}

const listRequest = (http: HttpTestingController) =>
  http.expectOne((r) => r.url === '/api/transactions');

describe('TransactionsPageService (F9.5)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('sends the filters as parameters and pages on the server', async () => {
    const { service, http } = setup();
    await settle();
    listRequest(http).flush(page([tx()], 80));
    await settle();
    expect(service.pager.pageCount()).toBe(4);

    service.period.set({ from: '2025-01-01', to: '2025-12-31' });
    service.kind.set('unknown');
    service.review.set(true);
    await settle();
    const filtered = listRequest(http);
    expect(filtered.request.params.get('from')).toBe('2025-01-01');
    expect(filtered.request.params.get('kind')).toBe('unknown');
    expect(filtered.request.params.get('review')).toBe('true');
    expect(filtered.request.params.get('offset')).toBe('0');
    filtered.flush(page([]));
    await settle();
    expect(service.filtered()).toBe(true);
  });

  it('selects on the current page; a new page clears the selection', async () => {
    const { service, http } = setup();
    await settle();
    listRequest(http).flush(page([tx(), tx({ key: 'f:3' })], 60));
    await settle();
    service.toggleAll();
    expect(service.selectedRows().map((t) => t.key)).toEqual(['f:2', 'f:3']);
    service.pager.setPage(1);
    await settle();
    listRequest(http).flush(page([tx({ key: 'f:9' })], 60));
    await settle();
    expect(service.selected().size).toBe(0);
  });
});

describe('global edits (F9.8, F9.9)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('names the closed projects of a 409 transactionLocked', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'transactionLocked',
        projects: [{ id: 'p', name: 'Steuern 2024', taxYear: 2024 }],
      },
    });
    expect(lockedProjectsOf(error)).toEqual(['Steuern 2024 2024']);
    expect(lockedProjectsOf(new HttpErrorResponse({ status: 409 }))).toEqual(
      [],
    );
  });

  it('posts an edit and returns the locking projects instead of failing', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideAppHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
      ],
    });
    const edits = TestBed.inject(TransactionEditsService);
    const http = TestBed.inject(HttpTestingController);
    const saved = edits.edit(['f:2'], { kind: 'transfer' }, 'Umbuchung');
    const request = http.expectOne('/api/transactions/edits');
    expect(request.request.body).toEqual({
      keys: ['f:2'],
      changes: { kind: 'transfer' },
      reason: 'Umbuchung',
    });
    request.flush({ edited: 1, projectIds: ['p1'] });
    expect(await saved).toEqual([]);

    const refused = edits.edit(['f:2'], { hidden: true }, 'x');
    http.expectOne('/api/transactions/edits').flush(
      {
        code: 'transactionLocked',
        projects: [{ id: 'p', name: 'Steuern 2024', taxYear: 2024 }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    expect(await refused).toEqual(['Steuern 2024 2024']);
    http.verify();
  });
});

describe('row menu and counter-bookings', () => {
  it('hides every change while a closed project locks the transaction — the AI review stays', () => {
    const visible = (t: Transaction) =>
      ledgerActions(t)
        .filter((a) => !a.hidden)
        .map((a) => a.id);
    expect(visible(tx())).toEqual(['detail', 'edit', 'link', 'ai', 'hide']);
    expect(
      visible(
        tx({
          lockedBy: [
            {
              projectId: 'p',
              name: 'Steuern 2024',
              taxYear: 2024,
              status: 'closed',
              active: true,
            },
          ],
        }),
      ),
      // User request 08.10.2026: single transactions can be reviewed with AI, also locked ones
      // (it only suggests; accepting stays refused).
    ).toEqual(['detail', 'ai']);
  });

  it('finds counter-bookings: same asset, opposite sign, another account, ±7 days, nearest first', () => {
    const out = tx();
    const candidates = counterCandidates(out, [
      out,
      tx({
        key: 'a',
        platform: 'ledger',
        quantity: '0.5',
        timestamp: '2025-03-03T00:00:00.000Z',
      }),
      tx({
        key: 'b',
        platform: 'ledger',
        quantity: '0.5',
        timestamp: '2025-03-01T12:00:00.000Z',
      }),
      tx({ key: 'c', platform: 'ledger', quantity: '-0.5' }),
      tx({ key: 'd', platform: 'ledger', quantity: '0.5', asset: 'ETH' }),
      tx({
        key: 'e',
        platform: 'ledger',
        quantity: '0.5',
        timestamp: '2025-04-01T00:00:00.000Z',
      }),
      tx({ key: 'f', quantity: '0.5' }),
    ]);
    expect(candidates.map((c) => c.key)).toEqual(['b', 'a']);
  });
});
