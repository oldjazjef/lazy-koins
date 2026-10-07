import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  LibraryEntry,
  MappingSummary,
  PublishQuota,
  PublishReview,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { blockOf, BulkPublishService } from './bulk-publish.service';

const summary = (id: string, over: Partial<MappingSummary> = {}) =>
  ({
    id,
    name: `Mapping ${id}`,
    platform: 'bank',
    fingerprint: 'a|b',
    version: 1,
    origin: 'manual',
    spec: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    filesUsing: 0,
    projectsUsing: 0,
    ...over,
  }) satisfies MappingSummary;

const review = (over: Partial<PublishReview> = {}): PublishReview => ({
  spec: { name: 'x' },
  name: 'x',
  platform: 'bank',
  fingerprint: 'a|b',
  size: 100,
  maxSize: 65536,
  findings: [],
  target: null,
  existing: null,
  lastAuthorName: null,
  libraryCopy: false,
  ...over,
});

const entry = (id: string, version = 1) =>
  ({ id, version, name: id }) as unknown as LibraryEntry;

const QUOTA: PublishQuota = {
  newPerDay: 10,
  usedToday: 9,
  remainingToday: 1,
  publishesPer10Min: 10,
};

const EMAIL = {
  path: '/description',
  kind: 'email' as const,
  value: 'x@example.org',
  removable: true,
};

/** Lets the awaited request chains move on. */
const tick = async (times = 3) => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve));
  }
};

async function next(
  http: HttpTestingController,
  url: string,
): Promise<TestRequest> {
  for (let i = 0; i < 50; i += 1) {
    const [found] = http.match(url);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`no request for ${url}`);
}

function setup() {
  TestBed.configureTestingModule({
    providers: [
      BulkPublishService,
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
  return {
    bulk: TestBed.inject(BulkPublishService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('BulkPublishService (F5.20)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('reviews every mapping, ticks removable findings, blocks library copies, warns about the quota', async () => {
    const { bulk, http } = setup();
    const started = bulk.start([
      summary('m1'),
      summary('m2', { origin: 'library' }),
      summary('m3'),
    ]);
    (await next(http, '/api/library/quota')).flush(QUOTA);
    // m1: a finding → reviewed again with it removed.
    const r1 = await next(http, '/api/library/review');
    expect(r1.request.body).toEqual({ mappingId: 'm1', remove: [] });
    r1.flush(review({ findings: [EMAIL], lastAuthorName: 'Krypto' }));
    const r1b = await next(http, '/api/library/review');
    expect(r1b.request.body).toEqual({
      mappingId: 'm1',
      remove: ['/description'],
    });
    r1b.flush(review());
    // m2: a library copy.
    (await next(http, '/api/library/review')).flush(
      review({ libraryCopy: true }),
    );
    // m3: already published from this mapping → a new version by default.
    (await next(http, '/api/library/review')).flush(
      review({ existing: { id: 'l3', version: 2 } }),
    );
    await started;

    const [m1, m2, m3] = bulk.items();
    expect(m1?.selected.has('/description')).toBe(true);
    expect(blockOf(m2 as never)).toBe('libraryCopy');
    expect(m3?.mode).toBe('version');
    expect(bulk.authorName()).toBe('Krypto');
    expect(bulk.toPublish().map((i) => i.mapping.id)).toEqual(['m1', 'm3']);
    expect(bulk.newCount()).toBe(1);
    expect(bulk.exceedsToday()).toBe(false);
    bulk.setMode('m3', 'new');
    expect(bulk.exceedsToday()).toBe(true);
    // Nothing without the explicit confirmation.
    expect(bulk.canPublish()).toBe(false);
    bulk.confirmed.set(true);
    expect(bulk.canPublish()).toBe(true);
  });

  it('remaining findings must be kept on purpose', async () => {
    const { bulk, http } = setup();
    const started = bulk.start([summary('m1')]);
    (await next(http, '/api/library/quota')).flush(QUOTA);
    const kept = { ...EMAIL, removable: false, path: '/name' };
    (await next(http, '/api/library/review')).flush(
      review({ findings: [kept] }),
    );
    await started;
    bulk.confirmed.set(true);
    expect(bulk.remainingFindings()).toBe(1);
    expect(bulk.canPublish()).toBe(false);
    bulk.acknowledged.set(true);
    expect(bulk.canPublish()).toBe(true);
  });

  it('publishes one by one with the single dialog’s body and reports each result', async () => {
    const { bulk, http } = setup();
    const published = vi.fn();
    bulk.onPublished = published;
    const started = bulk.start([
      summary('m1'),
      summary('m2'),
      summary('m3'),
      summary('m4'),
    ]);
    (await next(http, '/api/library/quota')).flush(QUOTA);
    (await next(http, '/api/library/review')).flush(review());
    (await next(http, '/api/library/review')).flush(
      review({ existing: { id: 'l2', version: 1 } }),
    );
    (await next(http, '/api/library/review')).flush(review());
    (await next(http, '/api/library/review')).flush(review());
    await started;
    bulk.authorName.set(' Krypto ');
    bulk.confirmed.set(true);

    const run = bulk.publishAll();
    const p1 = await next(http, '/api/library');
    expect(p1.request.body).toEqual({
      mappingId: 'm1',
      remove: [],
      authorName: 'Krypto',
      confirmed: true,
      acknowledgeFindings: false,
    });
    p1.flush(entry('l1'));
    const p2 = await next(http, '/api/library');
    expect(p2.request.body).toMatchObject({ mappingId: 'm2', libraryId: 'l2' });
    p2.flush(entry('l2', 2));
    (await next(http, '/api/library')).flush(
      { code: 'alreadyPublished', libraryId: 'l9' },
      { status: 409, statusText: 'Conflict' },
    );
    (await next(http, '/api/library')).flush(
      { code: 'publishLimit' },
      { status: 429, statusText: 'Too Many Requests' },
    );
    (await next(http, '/api/library/quota')).flush(QUOTA);
    await run;

    expect(bulk.phase()).toBe('done');
    expect(bulk.items().map((i) => i.result?.state)).toEqual([
      'published',
      'published',
      'already',
      'refused',
    ]);
    expect(bulk.items()[3]?.result).toMatchObject({ code: 'publishLimit' });
    expect(bulk.counts()).toEqual({ published: 2, already: 1, refused: 1 });
    expect(published).toHaveBeenCalledTimes(1);

    // "Neue Version" for the unchanged one.
    const again = bulk.publishVersion('m3');
    const p3 = await next(http, '/api/library');
    expect(p3.request.body).toMatchObject({ mappingId: 'm3', libraryId: 'l9' });
    p3.flush(entry('l9', 2));
    await again;
    expect(bulk.items()[2]?.result?.state).toBe('published');
  });

  it('a 429 from the HTTP budget is reported as rate limited, skipped items are not sent', async () => {
    const { bulk, http } = setup();
    const started = bulk.start([summary('m1'), summary('m2')]);
    (await next(http, '/api/library/quota')).flush(QUOTA);
    (await next(http, '/api/library/review')).flush(review());
    (await next(http, '/api/library/review')).flush(review());
    await started;
    bulk.setMode('m2', 'skip');
    bulk.confirmed.set(true);
    const run = bulk.publishAll();
    (await next(http, '/api/library')).flush(
      { message: 'ThrottlerException' },
      { status: 429, statusText: 'Too Many Requests' },
    );
    (await next(http, '/api/library/quota')).flush(QUOTA);
    await run;
    await tick();
    expect(bulk.items()[0]?.result).toMatchObject({
      state: 'refused',
      code: 'rateLimited',
    });
    expect(bulk.items()[1]?.result).toBeNull();
  });
});
