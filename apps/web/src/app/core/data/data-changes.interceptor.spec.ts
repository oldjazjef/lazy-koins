import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { type DataChange, DataChanges } from './data-changes';
import { changeOf, dataChangesInterceptor } from './data-changes.interceptor';

const P = '0190a1b2-0000-7000-8000-000000000001';

/** User rule (08.10.2026): every change refreshes every view of the affected data. */
describe('changeOf — URL/method → scope and project', () => {
  const cases: readonly (readonly [string, string, DataChange | null])[] = [
    // Reads never report.
    ['GET', `/api/projects/${P}/result`, null],
    ['GET', '/api/mappings', null],
    // Project data: files, calculation, corrections, rates, exports, mail, F4.7, hints, items.
    ['POST', `/api/projects/${P}/files`, { projectId: P, scope: 'files' }],
    // F5.21: how a file is read is the file's — every project selecting it follows.
    [
      'DELETE',
      `/api/projects/${P}/files/f1`,
      { projectId: null, scope: 'files' },
    ],
    [
      'PATCH',
      `/api/projects/${P}/files/f1`,
      { projectId: null, scope: 'files' },
    ],
    // F5.22: Dateien auswählen.
    [
      'POST',
      `/api/projects/${P}/files/select`,
      { projectId: P, scope: 'files' },
    ],
    // F5.7a: (de)activating a file also settles/raises its notifications.
    [
      'PATCH',
      `/api/projects/${P}/files/f1/active`,
      { projectId: P, scope: ['notifications', 'files'] },
    ],
    // F9.8–F9.10: global transaction edits change every project that reads them.
    [
      'POST',
      '/api/transactions/edits',
      { projectId: null, scope: 'transactions' },
    ],
    [
      'POST',
      '/api/transactions/edits/e1/undo',
      { projectId: null, scope: 'transactions' },
    ],
    [
      'POST',
      '/api/transactions/suggestions/accept',
      { projectId: null, scope: 'transactions' },
    ],
    [
      'POST',
      '/api/transactions/mapping-rule',
      { projectId: null, scope: ['mappings', 'transactions'] },
    ],
    ['POST', '/api/transactions/ai/suggest', { scope: 'transactions' }],
    [
      'POST',
      '/api/transactions/suggestions/dismiss',
      { scope: 'transactions' },
    ],
    ['POST', '/api/transactions/ai/payload', null],
    // F5.21: my files.
    ['POST', '/api/files', { scope: 'files' }],
    ['PATCH', '/api/files/f1', { projectId: null, scope: 'files' }],
    ['DELETE', '/api/files/f1', { projectId: null, scope: 'files' }],
    ['POST', `/api/projects/${P}/calculate`, { projectId: P }],
    ['POST', `/api/projects/${P}/corrections`, { projectId: P }],
    ['POST', `/api/projects/${P}/corrections/c1/undo`, { projectId: P }],
    ['POST', `/api/projects/${P}/rates/refresh`, { projectId: P }],
    ['PUT', `/api/projects/${P}/rates/manual`, { projectId: P }],
    ['DELETE', `/api/projects/${P}/rates/manual`, { projectId: P }],
    ['POST', `/api/projects/${P}/rates/estv/apply`, { projectId: P }],
    ['POST', `/api/projects/${P}/exports`, { projectId: P }],
    ['POST', `/api/projects/${P}/mail/send`, { projectId: P }],
    ['PUT', `/api/projects/${P}/sent`, { projectId: P }],
    ['PATCH', `/api/projects/${P}/hints`, { projectId: P }],
    ['PATCH', `/api/projects/${P}/open-items`, { projectId: P }],
    ['PATCH', `/api/projects/${P}`, { projectId: P }],
    ['DELETE', `/api/projects/${P}`, { projectId: P }],
    ['POST', `/api/projects/${P}/follow-up`, { projectId: P }],
    [
      'POST',
      `/api/projects/${P}/files/f1/ai/statement/accept`,
      { projectId: P, scope: 'files' },
    ],
    [
      'POST',
      `/api/projects/${P}/files/f1/ai/mapping/accept`,
      { projectId: null, scope: ['mappings', 'files'] },
    ],
    [
      'POST',
      `/api/projects/${P}/wallets/w1/balances`,
      { projectId: P, scope: 'wallets' },
    ],
    // New projects: the list.
    ['POST', '/api/projects', { scope: 'projects' }],
    ['POST', '/api/projects/import-package', { scope: 'projects' }],
    // Global data that every project reads.
    [
      'PUT',
      '/api/mappings/m1',
      { projectId: null, scope: ['mappings', 'files'] },
    ],
    [
      'POST',
      '/api/mappings/m1/reapply',
      { projectId: null, scope: ['mappings', 'files'] },
    ],
    [
      'DELETE',
      '/api/mappings/m1',
      { projectId: null, scope: ['mappings', 'files'] },
    ],
    [
      'POST',
      '/api/mappings',
      { projectId: null, scope: ['mappings', 'files'] },
    ],
    [
      'POST',
      '/api/ai/mapping-sample/accept',
      { projectId: null, scope: ['mappings', 'files'] },
    ],
    // F5.16: a library entry taken = a new mapping, maybe assigned to a file of any project.
    [
      'POST',
      '/api/library/l1/take',
      { projectId: null, scope: ['mappings', 'files'] },
    ],
    ['POST', '/api/library/review', null],
    // F5.19: a standard mapping taken = a copy, maybe assigned to a file of any project.
    [
      'POST',
      '/api/standard-mappings/kraken-ledger/take',
      { projectId: null, scope: ['mappings', 'files'] },
    ],
    // F5.18 (desktop): the link to a web library; its test stores nothing.
    ['PUT', '/api/settings/library', { scope: 'settings' }],
    // F7.4: a coin per ticker removes fetched prices in every open project + the dashboard cache.
    [
      'PUT',
      '/api/settings/coins/OPN',
      { projectId: null, scope: ['rates', 'settings'] },
    ],
    [
      'DELETE',
      '/api/settings/coins/OPN',
      { projectId: null, scope: ['rates', 'settings'] },
    ],
    [
      'PUT',
      '/api/settings/coins/TON/dismissal',
      { projectId: null, scope: ['rates', 'settings'] },
    ],
    [
      'POST',
      '/api/projects/p1/rates/coin',
      { projectId: null, scope: ['rates', 'settings'] },
    ],
    ['POST', '/api/settings/library/test', null],
    ['POST', '/api/library', null],
    ['PUT', '/api/library/l1/rating', null],
    ['DELETE', '/api/library/l1', null],
    ['POST', '/api/wallets/w1/fetch', { projectId: null, scope: 'wallets' }],
    [
      'POST',
      '/api/wallets/w1/check-networks',
      { projectId: null, scope: 'wallets' },
    ],
    ['PATCH', '/api/wallets/w1', { projectId: null, scope: 'wallets' }],
    ['POST', '/api/rates/estv/update', { projectId: null, scope: 'rates' }],
    // Settings and notifications.
    // Price sources: the provider order ranks every project's stored series.
    ['PUT', '/api/settings', { projectId: null, scope: ['rates', 'settings'] }],
    ['PUT', '/api/settings/wallets', { scope: 'settings' }],
    ['PUT', '/api/ai/settings', { scope: 'settings' }],
    ['PUT', '/api/mail/template', { scope: 'settings' }],
    ['PATCH', '/api/setup', { scope: 'settings' }],
    ['POST', '/api/notifications/n1/read', { scope: 'notifications' }],
    ['POST', '/api/notifications/read-all', { scope: 'notifications' }],
    // POSTs that only read: previews, inspections, AI proposals, tests of unsaved values.
    ['POST', `/api/projects/${P}/files/f1/mapping-preview`, null],
    ['POST', `/api/projects/${P}/files/f1/ai/mapping`, null],
    ['POST', `/api/projects/${P}/files/f1/ai/statement`, null],
    ['POST', `/api/projects/${P}/mail/compose`, null],
    ['POST', '/api/mapping-samples/inspect', null],
    ['POST', '/api/mapping-samples/preview', null],
    ['POST', '/api/ai/mapping-sample/payload', null],
    ['POST', '/api/ai/mapping-sample', null],
    ['POST', '/api/ai/settings/test', null],
    ['POST', '/api/mail/settings/test', null],
    ['POST', '/api/mail/template/preview', null],
    ['POST', '/api/settings/keys/coingecko/test', null],
    ['POST', '/api/settings/price-sources/coinmarketcap/test', null],
    ['POST', '/api/settings/wallets/test', null],
    ['POST', '/api/wallets/inspect', null],
    ['POST', '/api/dashboard/rates/refresh', null],
    // The chat: asking changes nothing; a confirmed proposal is reported by ChatService.
    ['POST', '/api/chat/conversations/c1/messages', null],
    ['POST', '/api/chat/conversations/c1/proposals/x/confirm', null],
    ['POST', '/api/pin/unlock', null],
    ['POST', '/api/pin/renew', null],
    // Not our API.
    ['POST', '/i18n/de-CH.json', null],
  ];

  it.each(cases)('%s %s', (method, url, expected) => {
    expect(changeOf(method, url)).toEqual(expected);
  });

  it('ignores the query string', () => {
    expect(changeOf('POST', `/api/projects/${P}/files?name=a.csv`)).toEqual({
      projectId: P,
      scope: 'files',
    });
  });
});

describe('dataChangesInterceptor', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([dataChangesInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    return {
      http: TestBed.inject(HttpClient),
      testing: TestBed.inject(HttpTestingController),
      changes: TestBed.inject(DataChanges),
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('reports a successful change, after the answer', async () => {
    const { http, testing, changes } = setup();
    const done = firstValueFrom(http.delete(`/api/projects/${P}/files/f1`));
    expect(changes.projectVersion(P)).toBe(0);
    testing.expectOne(`/api/projects/${P}/files/f1`).flush(null);
    await done;
    expect(changes.projectVersion(P)).toBe(1);
    expect(changes.globalVersion('projects')).toBe(1);
  });

  it('reports nothing for a failed change, a GET or a preview', async () => {
    const { http, testing, changes } = setup();
    const failed = firstValueFrom(
      http.post(`/api/projects/${P}/calculate`, {}),
    ).catch(() => undefined);
    testing
      .expectOne(`/api/projects/${P}/calculate`)
      .flush(
        { code: 'projectClosed' },
        { status: 409, statusText: 'Conflict' },
      );
    await failed;

    const read = firstValueFrom(http.get(`/api/projects/${P}/result`));
    testing.expectOne(`/api/projects/${P}/result`).flush({});
    await read;

    const preview = firstValueFrom(
      http.post(`/api/projects/${P}/files/f1/mapping-preview`, {}),
    );
    testing.expectOne(`/api/projects/${P}/files/f1/mapping-preview`).flush({});
    await preview;

    expect(changes.projectVersion(P)).toBe(0);
    expect(changes.globalVersion('projects')).toBe(0);
  });
});
