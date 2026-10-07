import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  LibraryEntry,
  LibraryStatus,
} from '../../../../core/api/api.types';
import { AuthService } from '../../../../core/auth/auth.service';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LibraryPageService, REMOTE_SEARCH_MAX } from './library-page.service';

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'l1',
  name: 'Kraken Ledger',
  platform: 'kraken',
  description: null,
  fingerprint: 'amount|asset',
  version: 1,
  authorName: null,
  ratingAverage: null,
  ratingCount: 0,
  usageCount: 0,
  publishedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  mine: false,
  myRating: null,
  ...over,
});

const LIST = [
  entry({
    id: 'l1',
    name: 'Kraken Ledger',
    ratingAverage: 4,
    ratingCount: 2,
    usageCount: 1,
  }),
  entry({
    id: 'l2',
    name: 'Binance Transaktionen',
    platform: 'binance',
    description: 'Spot und Earn',
    ratingAverage: 5,
    ratingCount: 1,
    usageCount: 7,
    publishedAt: '2026-10-05T00:00:00.000Z',
    mine: true,
  }),
  entry({
    id: 'l3',
    name: 'Revolut',
    platform: 'revolut',
    publishedAt: '2026-09-01T00:00:00.000Z',
  }),
];

/** httpResource issues its request from an effect; a flushed response lands one task later. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup(list: LibraryEntry[] = LIST) {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(LibraryPageService);
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  await settle();
  http.expectOne('/api/library').flush(list);
  await settle();
  return { service, http, notifications, navigate };
}

describe('LibraryPageService (F5.17)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('lists the library best rated first, with its platforms', async () => {
    const { service } = await setup();
    expect(service.visible().map((e) => e.id)).toEqual(['l2', 'l1', 'l3']);
    expect(service.platforms()).toEqual(['binance', 'kraken', 'revolut']);
    expect(service.isEmpty()).toBe(false);
  });

  it('searches name, platform and description; filters by platform', async () => {
    const { service } = await setup();
    service.search.set('EARN');
    expect(service.visible().map((e) => e.id)).toEqual(['l2']);
    service.search.set('');
    service.platform.set('revolut');
    expect(service.visible().map((e) => e.id)).toEqual(['l3']);
  });

  it('sorts by usage, newest and name', async () => {
    const { service } = await setup();
    service.sort.set('usage');
    expect(service.visible().map((e) => e.id)).toEqual(['l2', 'l1', 'l3']);
    service.sort.set('newest');
    expect(service.visible().map((e) => e.id)).toEqual(['l2', 'l1', 'l3']);
    service.sort.set('name');
    expect(service.visible().map((e) => e.id)).toEqual(['l2', 'l1', 'l3']);
  });

  it('takes an entry as a private copy; the toast opens the copy', async () => {
    const { service, http, notifications, navigate } = await setup();
    const taking = service.take(LIST[0] as LibraryEntry);
    const request = http.expectOne('/api/library/l1/take');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({
      mapping: { id: 'm9' },
      created: true,
      projectFileId: null,
      fileStatus: null,
    });
    await taking;
    await settle();
    http.expectOne('/api/library').flush(LIST);
    expect(notifications.success).toHaveBeenCalledWith(
      'library.take.done',
      expect.objectContaining({ labelKey: 'mappings.openPage' }),
    );
    const action = notifications.success.mock.calls[0]?.[1] as {
      onClick: () => void;
    };
    action.onClick();
    expect(navigate).toHaveBeenCalledWith(['/app/mappings', 'm9']);
  });

  it('rates (PUT) and removes my rating (DELETE), updating the row in place', async () => {
    const { service, http } = await setup();
    const rating = service.rate(LIST[0] as LibraryEntry, 3);
    const put = http.expectOne('/api/library/l1/rating');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ stars: 3 });
    put.flush(entry({ id: 'l1', myRating: 3, ratingAverage: 3.5 }));
    await rating;
    expect(service.visible().find((e) => e.id === 'l1')?.myRating).toBe(3);
    const removing = service.rate(LIST[0] as LibraryEntry, null);
    const del = http.expectOne('/api/library/l1/rating');
    expect(del.request.method).toBe('DELETE');
    del.flush(entry({ id: 'l1', myRating: null }));
    await removing;
    expect(service.visible().find((e) => e.id === 'l1')?.myRating).toBeNull();
  });

  it('deletes my entry and reloads; a failure is told by its code', async () => {
    const { service, http, notifications } = await setup();
    const removing = service.remove(LIST[1] as LibraryEntry);
    http
      .expectOne('/api/library/l2')
      .flush({ code: 'nope' }, { status: 404, statusText: 'Not Found' });
    await removing;
    expect(notifications.error).toHaveBeenCalledWith('library.delete.failed', {
      key: 'errors.status.notFound',
    });
    const again = service.remove(LIST[1] as LibraryEntry);
    http.expectOne('/api/library/l2').flush(null);
    await again;
    await settle();
    http.expectOne('/api/library').flush([LIST[0], LIST[2]]);
    await settle();
    expect(service.visible().map((e) => e.id)).toEqual(['l1', 'l3']);
  });
});

describe('LibraryPageService on the desktop (F5.18): a linked web library', () => {
  const LINKED: LibraryStatus = {
    mode: 'remote',
    available: true,
    readOnly: true,
    server: 'https://lazykoins.example.ch',
    suggestions: true,
    reason: null,
  };

  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  async function remote() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthService, useValue: { hasAccount: false } },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
      ],
    });
    const service = TestBed.inject(LibraryPageService);
    const http = TestBed.inject(HttpTestingController);
    await settle();
    http.expectOne('/api/library/status').flush(LINKED);
    await settle();
    http.expectOne('/api/library').flush(LIST);
    await settle();
    return { service, http };
  }

  it('is read-only and names the server', async () => {
    const { service } = await remote();
    expect(service.readOnly()).toBe(true);
    expect(service.server()).toBe('https://lazykoins.example.ch');
    expect(service.visible()).toHaveLength(3);
    expect(service.truncated()).toBe(false);
  });

  it('sends the search to the server (debounced) and says when the answer is cut', async () => {
    const { service, http } = await remote();
    service.search.set('kra');
    service.search.set('kraken ');
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    const many = Array.from({ length: REMOTE_SEARCH_MAX }, (_, i) =>
      entry({ id: `x${i}`, name: `Kraken ${i}` }),
    );
    http.expectOne('/api/library?q=kraken').flush(many);
    await settle();
    expect(service.truncated()).toBe(true);
  });

  it('shows the code of a failure of the linked server', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthService, useValue: { hasAccount: false } },
        { provide: NotificationService, useValue: {} },
      ],
    });
    const service = TestBed.inject(LibraryPageService);
    const http = TestBed.inject(HttpTestingController);
    await settle();
    http.expectOne('/api/library/status').flush(LINKED);
    await settle();
    http
      .expectOne('/api/library')
      .flush(
        { code: 'libraryNetwork', detail: 'ECONNREFUSED' },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await settle();
    expect(service.errorKey()).toBe('errors.api.libraryNetwork');
  });
});
