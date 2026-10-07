import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { PublishReview } from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LibraryPublishService } from './library-publish.service';

const SPEC = { format: 'lazy-koins-mapping', name: 'Bank', platform: 'bank' };

const review = (over: Partial<PublishReview> = {}): PublishReview => ({
  spec: SPEC,
  name: 'Bank',
  platform: 'bank',
  fingerprint: 'a|b',
  size: 120,
  maxSize: 65536,
  findings: [],
  target: null,
  existing: null,
  lastAuthorName: null,
  ...over,
});

const FINDINGS: PublishReview['findings'] = [
  {
    path: '/description',
    kind: 'email',
    value: 'x@example.org',
    removable: true,
  },
  {
    path: '/name',
    kind: 'accountId',
    value: 'Bank 12345678',
    removable: false,
  },
];

/** Lets the awaited request chains move on. */
const tick = () => new Promise((resolve) => setTimeout(resolve));

async function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      LibraryPublishService,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(LibraryPublishService);
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  return { service, http, notifications, navigate };
}

describe('LibraryPublishService (F5.15 review step)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('reviews, ticks removable findings, reviews again with them removed', async () => {
    const { service, http } = await setup();
    service.start({ mappingId: 'm1' });
    const first = http.expectOne('/api/library/review');
    expect(first.request.body).toEqual({ mappingId: 'm1', remove: [] });
    first.flush(review({ findings: FINDINGS, lastAuthorName: 'Krypto' }));
    await tick();
    const second = http.expectOne('/api/library/review');
    expect(second.request.body).toEqual({
      mappingId: 'm1',
      remove: ['/description'],
    });
    second.flush(review({ findings: [FINDINGS[1] as never] }));
    await tick();
    expect(service.authorName()).toBe('Krypto');
    // The flagged description is not prefilled into the text field.
    expect(service.description()).toBe('');
    expect([...service.selected()]).toEqual(['/description']);
    expect(service.remaining()).toHaveLength(1);
    // Confirmation alone is not enough while findings remain.
    service.confirmed.set(true);
    expect(service.canPublish()).toBe(false);
    service.acknowledged.set(true);
    expect(service.canPublish()).toBe(true);
  });

  it('publishes with the same removals, confirmed, and opens the entry from the toast', async () => {
    const { service, http, notifications, navigate } = await setup();
    const published = vi.fn();
    service.onPublished = published;
    service.start({ mappingId: 'm1' });
    http.expectOne('/api/library/review').flush(review());
    await tick();
    http.expectOne('/api/library/review').flush(review());
    await tick();
    expect(service.canPublish()).toBe(false);
    service.confirmed.set(true);
    service.authorName.set('  ');
    service.description.set('Mein Bank-Export');
    const publishing = service.publish();
    const post = http.expectOne('/api/library');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      mappingId: 'm1',
      remove: [],
      description: 'Mein Bank-Export',
      authorName: null,
      confirmed: true,
      acknowledgeFindings: false,
    });
    post.flush({ id: 'l7', version: 1 });
    await publishing;
    expect(service.open()).toBe(false);
    expect(published).toHaveBeenCalledWith({ id: 'l7', version: 1 });
    const action = notifications.success.mock.calls[0]?.[1] as {
      onClick: () => void;
    };
    action.onClick();
    expect(navigate).toHaveBeenCalledWith(['/app/library', 'l7']);
  });

  it('offers a new version of my existing entry (from the same mapping) by default', async () => {
    const { service, http } = await setup();
    service.start({ mappingId: 'm1' });
    http
      .expectOne('/api/library/review')
      .flush(review({ existing: { id: 'l1', version: 2 } }));
    await tick();
    const again = http.expectOne('/api/library/review');
    expect(again.request.body).toEqual({
      mappingId: 'm1',
      libraryId: 'l1',
      remove: [],
    });
    again.flush(
      review({
        existing: { id: 'l1', version: 2 },
        target: { id: 'l1', nextVersion: 3 },
      }),
    );
    await tick();
    expect(service.libraryId()).toBe('l1');
    service.asNewVersion(false);
    http.expectOne('/api/library/review').flush(review());
    await tick();
    expect(service.libraryId()).toBeUndefined();
  });

  it('shows the issues of an invalid .json instead of a review', async () => {
    const { service, http } = await setup();
    service.start();
    // useFile waits for the review: flush it while it is pending.
    const using = service.useFile({
      name: 'bad.json',
      text: () => Promise.resolve('{"format":"nope"}'),
    } as unknown as File);
    await tick();
    http
      .expectOne('/api/library/review')
      .flush(
        { issues: [{ path: 'format', message: 'Invalid input' }] },
        { status: 400, statusText: 'Bad Request' },
      );
    await using;
    expect(service.review()).toBeNull();
    expect(service.issues()).toEqual([
      { path: 'format', message: 'Invalid input' },
    ]);
  });
});
