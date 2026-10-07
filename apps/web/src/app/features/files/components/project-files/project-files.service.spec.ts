import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  Mapping,
  ProjectFile,
  ProjectFiles,
} from '../../../../core/api/api.types';
import { ActivityService } from '../../../../core/activity/activity.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { fileNameFrom } from '../../../../shared/files/save-blob';
import { skeleton } from '../mapping-editor';
import { MappingEditorState } from '../project-mappings/mapping-editor.state';
import {
  MAX_FILE_BYTES,
  ProjectFilesService,
  uploadErrorKey,
} from './project-files.service';

const file = (over: Partial<ProjectFile> = {}): ProjectFile => ({
  id: 'f1',
  sha256: 'a'.repeat(64),
  displayName: 'ledger.csv',
  kind: 'csv',
  size: 1234,
  status: 'needs_mapping',
  platform: null,
  mappingId: null,
  mappingName: null,
  period: null,
  bookingCount: 0,
  holdingCount: 0,
  errorCount: 0,
  origin: 'uploaded',
  originProjectId: null,
  originProjectName: null,
  derivedFromFileId: null,
  derivedFromName: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const mapping = (over: Partial<Mapping> = {}): Mapping => ({
  id: 'm1',
  name: 'Kraken Ledger',
  platform: 'kraken',
  fingerprint: 'amount|asset',
  version: 1,
  origin: 'manual',
  spec: { format: 'lazy-koins-mapping' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const overview = (files: ProjectFile[]): ProjectFiles => ({
  taxYear: 2025,
  groups: [{ platform: null, files }],
  missing: [],
});

/** httpResource issues its request from an effect; a flushed response lands one task later. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup(files: ProjectFile[] = [file()]) {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ProjectFilesService,
      MappingEditorState,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(ProjectFilesService);
  const http = TestBed.inject(HttpTestingController);
  service.projectId.set('p1');
  await settle();
  http.expectOne('/api/projects/p1/files').flush(overview(files));
  http.expectOne('/api/projects/p1/mappings').flush([]);
  http.expectOne('/api/mappings').flush([mapping()]);
  await settle();
  return { service, http, notifications };
}

/** Waits (a few tasks) until a request matching `url` is pending — File.text() is async. */
async function pending(http: HttpTestingController, url: string) {
  for (let i = 0; i < 50; i += 1) {
    const [found] = http.match(url);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no request for ${url}`);
}

/** Answers the reloads that follow a change. */
async function flushReloads(
  http: HttpTestingController,
  files: ProjectFile[] = [],
) {
  await settle();
  http.expectOne('/api/projects/p1/files').flush(overview(files));
  http.expectOne('/api/projects/p1/mappings').flush([]);
  http.expectOne('/api/mappings').flush([mapping()]);
  await settle();
}

/** A picked .json file (jsdom's File has no text()). */
const jsonFile = (text: string, name: string) =>
  ({ name, text: () => Promise.resolve(text) }) as unknown as File;

const csv = (name: string, size = 10) =>
  new File(['x'.repeat(size)], name, { type: 'text/csv' });

describe('ProjectFilesService', () => {
  afterEach(() => {
    try {
      verifyIgnoringHints(TestBed.inject(HttpTestingController));
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the files, the project mappings and my mappings', async () => {
    const { service } = await setup([file(), file({ id: 'f2', kind: 'pdf' })]);
    expect(service.files().map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(service.tableFiles().map((f) => f.id)).toEqual(['f1']);
    expect(service.myMappings.value()?.[0]?.name).toBe('Kraken Ledger');
  });

  it('uploads several files one by one as raw bytes, reporting each failure (F5.1, F5.4)', async () => {
    const { service, http, notifications } = await setup();
    const done = service.upload([
      csv('a.csv'),
      csv('b.csv'),
      csv('big.csv', 0),
    ]);
    await settle();
    const first = http.expectOne(
      (r) => r.url === '/api/projects/p1/files' && r.method === 'POST',
    );
    expect(first.request.params.get('name')).toBe('a.csv');
    expect(first.request.headers.get('Content-Type')).toBe(
      'application/octet-stream',
    );
    expect(first.request.body).toBeInstanceOf(File);
    // The activity indicator shows the batch with its progress.
    const activity = TestBed.inject(ActivityService);
    expect(activity.tasks()[0]?.label).toBe('activity.upload');
    expect(activity.tasks()[0]?.progress()).toEqual({ done: 0, total: 3 });
    first.flush(file({ id: 'new' }), { status: 201, statusText: 'Created' });
    await settle();
    expect(activity.tasks()[0]?.progress()).toEqual({ done: 1, total: 3 });
    const second = http.expectOne((r) => r.method === 'POST');
    expect(second.request.params.get('name')).toBe('b.csv');
    second.flush(
      {
        statusCode: 409,
        message: 'This file is already in the project',
        existing: file(),
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    http.expectOne((r) => r.method === 'POST').flush(file({ id: 'n3' }));
    await flushReloads(http);
    await done;
    expect(notifications.error).toHaveBeenCalledWith(
      'files.upload.duplicate',
      'b.csv',
    );
    expect(notifications.info).toHaveBeenCalledWith('files.upload.added', {
      count: 2,
    });
    expect(service.uploads().map((u) => u.state)).toEqual([
      'done',
      'failed',
      'done',
    ]);
    expect(service.uploadProgress()).toBe(100);
  });

  it('refuses a file over 20 MB before sending it', async () => {
    const { service, http, notifications } = await setup();
    const big = csv('big.csv');
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    await service.upload([big]);
    http.expectNone((r) => r.method === 'POST');
    expect(notifications.error).toHaveBeenCalledWith(
      'files.upload.tooBig',
      'big.csv',
    );
  });

  it('removes a file and assigns a mapping, then reloads', async () => {
    const { service, http } = await setup();
    const removed = service.remove(file());
    const del = http.expectOne('/api/projects/p1/files/f1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    await removed;
    await flushReloads(http);

    const assigned = service.assign(file(), {
      mode: 'mapping',
      mappingId: 'm1',
    });
    const patch = http.expectOne('/api/projects/p1/files/f1');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ mode: 'mapping', mappingId: 'm1' });
    patch.flush(file({ status: 'mapped', mappingId: 'm1' }));
    await assigned;
    await flushReloads(http);
  });

  it('checks a spec: schema issues come back as data, a preview as the result', async () => {
    const { service, http } = await setup();
    const bad = service.checkMapping(file(), { spec: { format: 'x' } });
    const request = http.expectOne('/api/projects/p1/files/f1/mapping-preview');
    expect(request.request.body).toEqual({ spec: { format: 'x' }, limit: 20 });
    request.flush(
      {
        message: 'The mapping spec is invalid',
        issues: [{ path: 'format', message: 'Invalid input' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(await bad).toEqual({
      ok: false,
      issues: [{ path: 'format', message: 'Invalid input' }],
    });

    const good = service.checkMapping(file(), { mappingId: 'm1' }, 5);
    const preview = {
      bookings: [],
      holdings: [],
      errors: [],
      notes: [],
      period: null,
      totals: { bookings: 0, holdings: 0, errors: 0, notes: 0 },
    };
    http.expectOne('/api/projects/p1/files/f1/mapping-preview').flush(preview);
    expect(await good).toEqual({ ok: true, preview });
  });

  it('imports a mapping .json: not JSON is refused locally, invalid specs show the issues', async () => {
    const { service, http, notifications } = await setup();
    expect(
      await service.importMappingFile(jsonFile('{nope', 'x.json')),
    ).toBeUndefined();
    expect(notifications.error).toHaveBeenCalledWith(
      'mappings.upload.notJson',
      'x.json',
    );

    const invalid = service.importMappingFile(
      jsonFile('{"format":"x"}', 'y.json'),
    );
    const post = await pending(http, '/api/mappings');
    expect(post.request.body).toEqual({
      spec: { format: 'x' },
      origin: 'copied',
    });
    post.flush(
      {
        message: 'The mapping spec is invalid',
        issues: [{ path: 'version', message: 'Invalid input' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(await invalid).toBeUndefined();
    expect(notifications.error).toHaveBeenCalledWith(
      'mappings.upload.invalid',
      'version: Invalid input',
    );
  });
});

describe('template download (F11.2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the template in the app language', async () => {
    const { service, http } = await setup();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:x',
      revokeObjectURL: () => undefined,
    });
    TestBed.inject(LanguageService).use('en');
    for (const [kind, url] of [
      ['xlsx', '/api/standard-format/template.xlsx?language=en'],
      [
        'bookings',
        '/api/standard-format/template.csv?type=bookings&language=en',
      ],
    ] as const) {
      const done = service.downloadTemplate(kind);
      const request = http.expectOne(url);
      request.flush(new Blob(['x']), {
        headers: {
          'Content-Disposition':
            'attachment; filename="lazy-koins-template.xlsx"',
        },
      });
      await done;
    }
  });
});

describe('upload messages and download names', () => {
  it('maps upload failures to messages', () => {
    const error = (status: number, body: unknown = null) =>
      new HttpErrorResponse({ status, error: body });
    expect(uploadErrorKey(error(409, { existing: {} }))).toBe(
      'files.upload.duplicate',
    );
    expect(uploadErrorKey(error(409, { message: 'closed' }))).toBe(
      'files.upload.closed',
    );
    expect(uploadErrorKey(error(413))).toBe('files.upload.tooBig');
    expect(uploadErrorKey(error(415))).toBe('files.upload.unsupported');
    expect(uploadErrorKey(error(422))).toBe('files.upload.unreadable');
    expect(uploadErrorKey(error(500))).toBe('files.upload.failed');
    expect(uploadErrorKey(new Error('offline'))).toBe('files.upload.failed');
  });
  it('reads the download name from Content-Disposition', () => {
    expect(
      fileNameFrom(
        'attachment; filename="a_b.csv"; filename*=UTF-8\'\'a%C3%A4b.csv',
        'x',
      ),
    ).toBe('aäb.csv');
    expect(fileNameFrom('attachment; filename="plain.csv"', 'x')).toBe(
      'plain.csv',
    );
    expect(fileNameFrom(null, 'fallback.csv')).toBe('fallback.csv');
  });

  it('loads the hints, dismisses one with a note and reopens it (F5.8)', async () => {
    const { service, http } = await setup();
    const hint = {
      key: 'endsEarly:kraken|spot',
      kind: 'endsEarly' as const,
      severity: 'warning' as const,
      platform: 'kraken',
      accountId: 'spot',
      accounts: ['spot'],
      date: '2025-02-09',
      zeroBalance: false,
      hintKey: 'files.missing.howTo.endsEarly',
      fileId: null,
      fileName: null,
      count: null,
      status: 'open' as const,
      note: '',
    };
    http
      .expectOne('/api/projects/p1/hints')
      .flush({ taxYear: 2025, hints: [hint], open: 1 });
    await settle();
    expect(service.openHints()).toBe(1);

    const done = service.setHintStatus(
      hint,
      'done',
      'Konto nach 09.02. nicht mehr genutzt',
    );
    const patch = http.expectOne('/api/projects/p1/hints');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({
      key: hint.key,
      status: 'done',
      note: 'Konto nach 09.02. nicht mehr genutzt',
    });
    patch.flush({ key: hint.key, status: 'done', note: '' });
    await done;
    await settle();
    http.expectOne('/api/projects/p1/hints').flush({
      taxYear: 2025,
      hints: [{ ...hint, status: 'done' }],
      open: 0,
    });
    await settle();
    expect(service.openHints()).toBe(0);

    const reopened = service.setHintStatus(hint, 'open');
    const again = http.expectOne(
      (r) => r.url === '/api/projects/p1/hints' && r.method === 'PATCH',
    );
    expect(again.request.body).toMatchObject({ status: 'open' });
    again.flush({ key: hint.key, status: 'open', note: '' });
    await reopened;
  });
});

describe('MappingEditorState', () => {
  afterEach(() => {
    try {
      verifyIgnoringHints(TestBed.inject(HttpTestingController));
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('starts a new mapping from the file header and assigns it to the file once saved', async () => {
    const { http } = await setup();
    const editor = TestBed.inject(MappingEditorState);
    const opening = editor.openNew(file());
    http.expectOne('/api/projects/p1/files/f1/preview?rows=5').flush({
      kind: 'table',
      sheets: [
        {
          name: 'ledger.csv',
          rows: [['txid', 'time', 'asset', ' amount ']],
          totalRows: 3,
        },
      ],
    });
    await opening;
    expect(editor.open()).toBe(true);
    expect(JSON.parse(editor.text())).toEqual(
      skeleton('ledger.csv', ['txid', 'time', 'asset', 'amount']),
    );

    editor.text.set('{not json');
    await editor.save();
    expect(editor.invalidJson()).toBe(true);

    editor.text.set('{"format":"lazy-koins-mapping"}');
    const saving = editor.save();
    http.expectOne('/api/mappings').flush(mapping({ id: 'm9' }));
    await settle();
    // saveMapping reloads the mapping lists, then the file is assigned.
    http.expectOne('/api/projects/p1/mappings').flush([]);
    http.expectOne('/api/mappings').flush([mapping()]);
    const patch = http.expectOne('/api/projects/p1/files/f1');
    expect(patch.request.body).toEqual({ mode: 'mapping', mappingId: 'm9' });
    patch.flush(file({ status: 'mapped' }));
    await saving;
    await flushReloads(http);
    expect(editor.open()).toBe(false);
  });
});

/** The hints (F5.8) reload with the files; their own behaviour is tested separately. */
function verifyIgnoringHints(http: HttpTestingController): void {
  for (const request of http.match('/api/projects/p1/hints')) {
    if (!request.cancelled) {
      request.flush({ taxYear: 2025, hints: [], open: 0 });
    }
  }
  http.verify();
}
