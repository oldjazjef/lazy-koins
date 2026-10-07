import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { Mapping } from '../../core/api/api.types';
import { ActivityService } from '../../core/activity/activity.service';
import { NotificationService } from '../../core/notifications/notification.service';
import {
  MappingImportService,
  MAX_MAPPING_FILE_BYTES,
  MAX_MAPPING_FILES,
} from './mapping-import.service';

/** A picked .json file (jsdom's File has no text()). */
const jsonFile = (text: string, name: string, size = text.length) =>
  ({ name, size, text: () => Promise.resolve(text) }) as unknown as File;

const mapping = (id: string): Mapping => ({
  id,
  name: `Mapping ${id}`,
  platform: 'kraken',
  fingerprint: 'a|b',
  version: 1,
  origin: 'copied',
  spec: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

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
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  return {
    service: TestBed.inject(MappingImportService),
    http: TestBed.inject(HttpTestingController),
    activity: TestBed.inject(ActivityService),
    notifications,
    navigate,
  };
}

describe('MappingImportService (F11.0u: several mapping files)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('stores, skips duplicates, reports invalid ones — one failure never stops the others', async () => {
    const { service, http, activity } = setup();
    const running = service.importFiles([
      jsonFile('{"name":"a"}', 'a.json'),
      jsonFile('{nope', 'broken.json'),
      jsonFile('{"name":"b"}', 'b.json'),
      jsonFile('{"name":"c"}', 'c.json'),
      jsonFile('{"name":"d"}', 'd.json'),
    ]);
    const a = await next(http, '/api/mappings');
    expect(a.request.body).toEqual({
      spec: { name: 'a' },
      origin: 'copied',
      rejectDuplicate: true,
    });
    expect(activity.tasks()[0]?.label).toBe('activity.mappingImport');
    expect(activity.tasks()[0]?.progress()).toEqual({ done: 0, total: 5 });
    a.flush(mapping('m1'));
    (await next(http, '/api/mappings')).flush(
      { code: 'duplicateMapping', existingId: 'm0', existingName: 'Kraken' },
      { status: 409, statusText: 'Conflict' },
    );
    (await next(http, '/api/mappings')).flush(
      {
        message: 'The mapping spec is invalid',
        issues: [{ path: 'version', message: 'Invalid input' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    (await next(http, '/api/mappings')).flush(null, {
      status: 500,
      statusText: 'Server Error',
    });
    await running;
    expect(service.results()).toEqual([
      { name: 'a.json', state: 'stored', mapping: mapping('m1') },
      { name: 'broken.json', state: 'notJson' },
      {
        name: 'b.json',
        state: 'duplicate',
        existingId: 'm0',
        existingName: 'Kraken',
      },
      {
        name: 'c.json',
        state: 'invalid',
        issues: [{ path: 'version', message: 'Invalid input' }],
      },
      {
        name: 'd.json',
        state: 'failed',
        error: { key: 'errors.status.server' },
      },
    ]);
    expect(service.summary()).toEqual({ stored: 1, duplicate: 1, problems: 3 });
    expect(activity.tasks()).toEqual([]);
    service.close();
    expect(service.results()).toBeNull();
  });

  it('refuses oversized files and more than the batch limit without sending them', async () => {
    const { service, http } = setup();
    const files = [
      jsonFile('{}', 'huge.json', MAX_MAPPING_FILE_BYTES + 1),
      ...Array.from({ length: MAX_MAPPING_FILES }, (_, i) =>
        jsonFile('[]', `n${i}.json`),
      ),
    ];
    await service.importFiles(files);
    const results = service.results() ?? [];
    expect(results[0]).toEqual({ name: 'huge.json', state: 'tooLarge' });
    // An array is not a mapping object: refused locally.
    expect(results[1]).toEqual({ name: 'n0.json', state: 'notJson' });
    expect(results.at(-1)).toEqual({
      name: `n${MAX_MAPPING_FILES - 1}.json`,
      state: 'tooMany',
    });
    http.expectNone('/api/mappings');
  });

  it('one stored file: a toast with a link, no dialog', async () => {
    const { service, http, notifications, navigate } = setup();
    const running = service.importFiles([jsonFile('{"a":1}', 'k.json')]);
    (await next(http, '/api/mappings')).flush(mapping('m5'));
    await running;
    expect(service.results()).toBeNull();
    const [key, action] = notifications.success.mock.calls[0] ?? [];
    expect(key).toBe('mappings.saved');
    (action as { onClick: () => void }).onClick();
    expect(navigate).toHaveBeenCalledWith(['/app/mappings', 'm5']);
  });
});
