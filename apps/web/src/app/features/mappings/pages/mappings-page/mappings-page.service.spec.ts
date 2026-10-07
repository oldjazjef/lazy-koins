import { provideAppHttpClient } from '../../../../core/data/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { MappingSummary } from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { MappingsPageService } from './mappings-page.service';

const summary = (over: Partial<MappingSummary> = {}): MappingSummary => ({
  id: 'm1',
  name: 'Kraken Ledger',
  platform: 'kraken',
  fingerprint: 'amount|asset',
  version: 1,
  origin: 'manual',
  spec: { format: 'lazy-koins-mapping' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  filesUsing: 0,
  projectsUsing: 0,
  ...over,
});

const LIST = [
  summary({
    id: 'm1',
    name: 'Kraken Ledger',
    platform: 'kraken',
    filesUsing: 3,
    projectsUsing: 2,
    updatedAt: '2026-02-01T00:00:00.000Z',
  }),
  summary({
    id: 'm2',
    name: 'Binance Transaktionen',
    platform: 'binance',
    origin: 'ai',
    updatedAt: '2026-03-01T00:00:00.000Z',
  }),
  summary({
    id: 'm3',
    name: 'Revolut',
    platform: 'revolut',
    filesUsing: 1,
    projectsUsing: 1,
    updatedAt: '2026-01-15T00:00:00.000Z',
  }),
];

/** httpResource issues its request from an effect; a flushed response lands one task later. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

/** A picked .json file (jsdom's File has no text()). */
const jsonFile = (text: string, name: string) =>
  ({ name, text: () => Promise.resolve(text) }) as unknown as File;

/** Waits (a few tasks) until a request matching `url` is pending — File.text() is async. */
async function pending(http: HttpTestingController, url: string) {
  for (let i = 0; i < 50; i += 1) {
    const [found] = http.match(url);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no request for ${url}`);
}

async function setup(list: MappingSummary[] = LIST) {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideAppHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(MappingsPageService);
  // As the page does: the list follows every change while it is on screen.
  TestBed.runInInjectionContext(() => service.follow());
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  await settle();
  http.expectOne('/api/mappings').flush(list);
  await settle();
  return { service, http, notifications, navigate };
}

describe('MappingsPageService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('lists all my mappings, by name first', async () => {
    const { service } = await setup();
    expect(service.visible().map((m) => m.id)).toEqual(['m2', 'm1', 'm3']);
    expect(service.isEmpty()).toBe(false);
  });

  it('knows when there is no mapping yet', async () => {
    const { service } = await setup([]);
    expect(service.isEmpty()).toBe(true);
  });

  it('searches name and platform, case-insensitively', async () => {
    const { service } = await setup();
    service.search.set('KRAKEN');
    expect(service.visible().map((m) => m.id)).toEqual(['m1']);
    service.search.set('trans');
    expect(service.visible().map((m) => m.id)).toEqual(['m2']);
    service.search.set('nothing');
    expect(service.visible()).toEqual([]);
  });

  it('sorts by platform, last change and usage', async () => {
    const { service } = await setup();
    service.sort.set('platform');
    expect(service.visible().map((m) => m.id)).toEqual(['m2', 'm1', 'm3']);
    service.sort.set('updated');
    expect(service.visible().map((m) => m.id)).toEqual(['m2', 'm1', 'm3']);
    service.sort.set('files');
    expect(service.visible().map((m) => m.id)).toEqual(['m1', 'm3', 'm2']);
  });

  it('stores a new mapping from the editor and opens its page; issues stay in the editor', async () => {
    const { service, http, navigate } = await setup();
    expect(await service.create('{nope')).toBe('invalidJson');

    const refused = service.create('{"format":"x"}');
    await settle();
    http.expectOne('/api/mappings').flush(
      {
        message: 'The mapping spec is invalid',
        issues: [{ path: 'format', message: 'Invalid' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(await refused).toEqual({
      ok: false,
      issues: [{ path: 'format', message: 'Invalid' }],
    });

    const created = service.create('{"format":"lazy-koins-mapping"}');
    await settle();
    const post = http.expectOne('/api/mappings');
    expect(post.request.body).toEqual({
      spec: { format: 'lazy-koins-mapping' },
      origin: 'manual',
    });
    post.flush(summary({ id: 'm9' }));
    await settle();
    http.expectOne('/api/mappings').flush(LIST);
    expect(await created).toMatchObject({ ok: true });
    expect(navigate).toHaveBeenCalledWith(['/app/mappings', 'm9']);
  });

  it('runs the after-save step (add the sample to a project) before opening the page', async () => {
    const { service, http, navigate } = await setup();
    const order: string[] = [];
    navigate.mockImplementation(async () => {
      order.push('navigate');
      return true;
    });
    const created = service.create('{"format":"lazy-koins-mapping"}', (m) => {
      order.push(`after:${m.id}`);
      return Promise.resolve();
    });
    await settle();
    http.expectOne('/api/mappings').flush(summary({ id: 'm7' }));
    await settle();
    http.expectOne('/api/mappings').flush(LIST);
    await created;
    expect(order).toEqual(['after:m7', 'navigate']);
  });

  it('stores a spec the AI wrote from a sample with origin ai', async () => {
    const { service, http } = await setup();
    const created = service.create(
      '{"format":"lazy-koins-mapping"}',
      undefined,
      'ai',
    );
    await settle();
    const post = http.expectOne('/api/ai/mapping-sample/accept');
    expect(post.request.body).toEqual({
      spec: { format: 'lazy-koins-mapping' },
    });
    post.flush(summary({ id: 'm8', origin: 'ai' }));
    await settle();
    http.expectOne('/api/mappings').flush(LIST);
    expect(await created).toMatchObject({ ok: true });
  });

  it('uploads a .json as a copied mapping, with a link to its page', async () => {
    const { service, http, notifications, navigate } = await setup();
    expect(await service.upload(jsonFile('{nope', 'x.json'))).toBeUndefined();
    expect(notifications.error).toHaveBeenCalledWith(
      'mappings.upload.notJson',
      'x.json',
    );

    const uploading = service.upload(
      jsonFile('{"format":"lazy-koins-mapping"}', 'kraken.mapping.json'),
    );
    const post = await pending(http, '/api/mappings');
    expect(post.request.body).toMatchObject({ origin: 'copied' });
    post.flush(summary({ id: 'm5' }));
    expect(await uploading).toMatchObject({ id: 'm5' });
    await settle();
    http.expectOne('/api/mappings').flush(LIST);

    const [key, action] = notifications.success.mock.calls[0] ?? [];
    expect(key).toBe('mappings.saved');
    (action as { onClick: () => void }).onClick();
    expect(navigate).toHaveBeenCalledWith(['/app/mappings', 'm5']);
  });
});
