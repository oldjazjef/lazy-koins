import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  AiRequestPreview,
  AiSettings,
  MappingCandidate,
  Project,
  ProjectFile,
  ProjectFiles,
  SampleInspection,
  SamplePreview,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import {
  MappingWorkbenchService,
  sampleErrorKey,
} from './mapping-workbench.service';

const SKELETON = {
  format: 'lazy-koins-mapping',
  version: 1,
  name: 'kraken-ledger',
  platform: 'kraken',
  match: { headers: ['time', 'amount'] },
};

const INSPECTION: SampleInspection = {
  name: 'kraken-ledger.csv',
  kind: 'csv',
  size: 40,
  sample: {
    fileName: 'kraken-ledger.csv',
    fileKind: 'csv',
    delimiter: ',',
    rowCount: 4,
    headerRowGuess: 2,
    rows: [
      ['Export'],
      ['time', 'type', 'amount'],
      ['2025-01-01', 'trade', '1'],
    ],
    distinctValues: [{ column: 'type', values: ['trade'] }],
  },
  skeleton: SKELETON,
  recognisedBy: { standard: false, mapping: null },
};

const live = (over: Partial<SamplePreview> = {}): SamplePreview => ({
  valid: true,
  issues: [],
  preview: {
    bookings: [],
    holdings: [],
    errors: [],
    notes: [],
    period: null,
    totals: { bookings: 3, holdings: 0, errors: 0, notes: 0 },
  },
  kindCounts: { unknown: 1, trade: 2 },
  unknownValues: [{ value: 'Reward', count: 1 }],
  fingerprint: {
    verdict: 'this',
    confidence: 1,
    recognisedBy: { standard: false, mapping: null },
  },
  ...over,
});

const projectFile = (over: Partial<ProjectFile> = {}): ProjectFile => ({
  id: 'f1',
  sha256: 'a'.repeat(64),
  displayName: 'kraken-ledger.csv',
  kind: 'csv',
  size: 40,
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

const PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    status: 'in_progress',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'p2',
    name: 'Steuern 2024',
    taxYear: 2024,
    country: 'CH',
    canton: 'ZH',
    status: 'closed',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

/** httpResource requests come from effects; flushed answers land a task later. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const csv = (name = 'kraken-ledger.csv', content = 'time,amount\n1,2') =>
  new File([content], name, { type: 'text/csv' });

function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      MappingWorkbenchService,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(MappingWorkbenchService);
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  service.previewDelay = 10;
  service.start('{"format":"lazy-koins-mapping"}');
  return { service, http, notifications, navigate };
}

/** Loads `kraken-ledger.csv` as the sample and answers the first preview. */
async function withSample(t: ReturnType<typeof setup>) {
  const loading = t.service.useFile(csv());
  const inspect = t.http.expectOne('/api/mapping-samples/inspect');
  inspect.flush(INSPECTION);
  await loading;
  const preview = t.http.expectOne('/api/mapping-samples/preview');
  preview.flush(live());
  await settle();
  return { inspect, preview };
}

describe('MappingWorkbenchService', () => {
  afterEach(() => {
    try {
      const http = TestBed.inject(HttpTestingController);
      // The project list loads in the background once a sample is there.
      http.match('/api/projects');
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('refuses a PDF, an empty and a too large file before asking the API', async () => {
    const t = setup();
    await t.service.useFile(new File(['%PDF-'], 'statement.pdf'));
    await t.service.useFile(new File([], 'empty.csv'));
    const big = csv();
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    await t.service.useFile(big);
    expect(t.notifications.error.mock.calls.map((call) => call[0])).toEqual([
      'mappings.sample.notTable',
      'mappings.sample.empty',
      'files.upload.tooBig',
    ]);
    expect(t.service.sample()).toBeNull();
  });

  it('inspects the sample, starts from its columns and previews the spec on it', async () => {
    const t = setup();
    const { inspect, preview } = await withSample(t);
    const form = inspect.request.body as FormData;
    expect(form.get('name')).toBe('kraken-ledger.csv');
    expect((form.get('file') as File).name).toBe('kraken-ledger.csv');
    // Nothing written yet: the skeleton replaced the starting text.
    expect(JSON.parse(t.service.text())).toEqual(SKELETON);
    const sent = preview.request.body as FormData;
    expect(JSON.parse(sent.get('spec') as string)).toEqual(SKELETON);
    expect(sent.get('limit')).toBe('50');
    expect(sent.get('mappingId')).toBeNull();
    expect(t.service.headerRow()).toBe(2);
    expect(t.service.rawWidth()).toBe(3);
    // Kinds in the standard format's order.
    expect(t.service.kindCounts()).toEqual([
      { kind: 'trade', count: 2 },
      { kind: 'unknown', count: 1 },
    ]);
    expect(t.service.live()?.fingerprint?.verdict).toBe('this');
  });

  it('keeps text the user already wrote; "Vorlage aus Datei" replaces it on request', async () => {
    const t = setup();
    t.service.edit('{"format":"lazy-koins-mapping","name":"Mine"}');
    const loading = t.service.useFile(csv());
    t.http.expectOne('/api/mapping-samples/inspect').flush(INSPECTION);
    await loading;
    t.http.expectOne('/api/mapping-samples/preview').flush(live());
    expect(JSON.parse(t.service.text())).toMatchObject({ name: 'Mine' });

    t.service.applyTemplate();
    expect(JSON.parse(t.service.text())).toEqual(SKELETON);
    t.http.expectOne('/api/mapping-samples/preview').flush(live());
    await settle();
  });

  it('previews once typing pauses, never invalid JSON, and drops stale answers', async () => {
    const t = setup();
    await withSample(t);
    t.service.edit('{"a":1}');
    t.service.edit('{"a":2}');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const debounced = t.http.match('/api/mapping-samples/preview');
    expect(debounced).toHaveLength(1);
    expect((debounced[0]?.request.body as FormData).get('spec')).toBe(
      '{"a":2}',
    );

    // A newer request wins over a slower older one.
    const second = t.service.refreshPreview();
    debounced[0]?.flush(live({ unknownValues: [{ value: 'old', count: 1 }] }));
    t.http.expectOne('/api/mapping-samples/preview').flush(
      live({
        valid: false,
        issues: [{ path: 'name', message: 'Required' }],
        preview: null,
        fingerprint: null,
      }),
    );
    await second;
    await settle();
    expect(t.service.live()?.valid).toBe(false);
    expect(t.service.issues()).toEqual([{ path: 'name', message: 'Required' }]);

    t.service.edit('{nope');
    await new Promise((resolve) => setTimeout(resolve, 30));
    t.http.expectNone('/api/mapping-samples/preview');
    expect(t.service.invalidJson()).toBe(true);
    expect(t.service.issues()).toEqual([]);
  });

  it('picks a table file of a project: lists projects, its non-PDF files, downloads the bytes', async () => {
    const t = setup();
    t.service.openPicker();
    await settle();
    t.http.expectOne('/api/projects').flush(PROJECTS);
    t.service.pickProject('p1');
    await settle();
    const files: ProjectFiles = {
      taxYear: 2025,
      groups: [
        {
          platform: null,
          files: [
            projectFile(),
            projectFile({ id: 'f2', kind: 'pdf', displayName: 'a.pdf' }),
          ],
        },
      ],
      missing: [],
    };
    t.http.expectOne('/api/projects/p1/files').flush(files);
    await settle();
    expect(t.service.pickableFiles().map((f) => f.id)).toEqual(['f1']);
    t.service.pickFileId.set('f1');
    const using = t.service.usePickedFile();
    t.http
      .expectOne('/api/projects/p1/files/f1/content')
      .flush(new Blob(['time,amount\n1,2']));
    await settle();
    t.http.expectOne('/api/mapping-samples/inspect').flush(INSPECTION);
    await using;
    t.http.expectOne('/api/mapping-samples/preview').flush(live());
    expect(t.service.sample()?.from).toEqual({ projectName: 'Steuern 2025' });
    expect(t.service.picking()).toBe(false);
    await settle();
    expect(t.service.openProjects().map((p) => p.id)).toEqual(['p1']);
  });

  it('shows why the API refused a sample', async () => {
    const t = setup();
    const loading = t.service.useFile(csv('scan.csv'));
    t.http
      .expectOne('/api/mapping-samples/inspect')
      .flush(
        { message: 'Only CSV and XLSX files can be a sample' },
        { status: 415, statusText: 'Unsupported Media Type' },
      );
    await loading;
    expect(t.notifications.error).toHaveBeenCalledWith(
      'mappings.sample.notTable',
      'scan.csv',
    );
    expect(t.service.sample()).toBeNull();
    const status = (code: number) =>
      sampleErrorKey(new HttpErrorResponse({ status: code }));
    expect(status(413)).toBe('files.upload.tooBig');
    expect(status(422)).toBe('mappings.sample.notTable');
    expect(status(500)).toBe('mappings.sample.loadFailed');
  });

  it('"Mit AI erstellen": not ready → explains; else payload, consent, proposal into the editor', async () => {
    const t = setup();
    await withSample(t);
    const settings = (over: Partial<AiSettings>): AiSettings => ({
      enabled: true,
      provider: 'openai_compatible',
      baseUrl: 'http://localhost:11435/v1',
      model: 'fake',
      hasApiKey: false,
      apiKeyHint: null,
      consentAt: null,
      ready: true,
      canStoreKey: true,
      privateUrlsAllowed: true,
      ...over,
    });

    const off = t.service.startAi();
    t.http.expectOne('/api/ai/settings').flush(settings({ enabled: false }));
    await off;
    expect(t.service.aiStep()).toBe('notReady');
    expect(t.service.aiNotReadyReason()).toBe('disabled');

    const starting = t.service.startAi();
    t.http.expectOne('/api/ai/settings').flush(settings({}));
    await settle();
    const payload: AiRequestPreview = {
      payload: { fileName: 'kraken-ledger.csv', rows: [['time', 'amount']] },
      provider: 'openai_compatible',
      baseUrl: '',
      model: '',
      consentGiven: false,
    };
    const payloadRequest = t.http.expectOne('/api/ai/mapping-sample/payload');
    expect((payloadRequest.request.body as FormData).get('name')).toBe(
      'kraken-ledger.csv',
    );
    payloadRequest.flush(payload);
    await starting;
    expect(t.service.aiStep()).toBe('consent');
    expect(t.service.aiPayloadText()).toContain('["time", "amount"]');
    expect(t.service.canSendAi()).toBe(false);
    await t.service.sendAi();
    t.http.expectNone('/api/ai/mapping-sample');

    t.service.consentChecked.set(true);
    const sending = t.service.sendAi();
    const generate = t.http.expectOne('/api/ai/mapping-sample');
    expect((generate.request.body as FormData).get('consent')).toBe('true');
    const candidate: MappingCandidate = {
      spec: { ...SKELETON, name: 'AI' },
      valid: true,
      issues: [],
      preview: null,
      kindCounts: {},
      unknownValues: [],
      problems: [],
      rounds: 1,
      model: 'fake',
      usage: null,
    };
    generate.flush(candidate);
    await sending;
    expect(t.service.aiStep()).toBe('closed');
    expect(JSON.parse(t.service.text())).toMatchObject({ name: 'AI' });
    expect(t.service.aiCandidate()?.model).toBe('fake');
    t.http.expectOne('/api/mapping-samples/preview').flush(live());
    await settle();
  });

  it('adds the sample to a project after saving and reads it with the new mapping', async () => {
    const t = setup();
    await withSample(t);
    const adding = t.service.addToProject('p1', { id: 'm9' });
    const upload = t.http.expectOne(
      (request) =>
        request.url === '/api/projects/p1/files' && request.method === 'POST',
    );
    expect(upload.request.params.get('name')).toBe('kraken-ledger.csv');
    expect(upload.request.headers.get('Content-Type')).toBe(
      'application/octet-stream',
    );
    // Another mapping was surer on upload: the file is assigned to the new one explicitly.
    upload.flush(projectFile({ status: 'mapped', mappingId: 'm1' }));
    await settle();
    const patch = t.http.expectOne('/api/projects/p1/files/f1');
    expect(patch.request.body).toEqual({ mode: 'mapping', mappingId: 'm9' });
    patch.flush(projectFile({ status: 'mapped', mappingId: 'm9' }));
    expect(await adding).toBe(true);
    expect(t.notifications.success).toHaveBeenCalledWith(
      'mappings.sample.addedToProject',
      expect.objectContaining({ labelKey: 'mappings.sample.openFile' }),
    );

    const duplicate = t.service.addToProject('p1', { id: 'm9' });
    t.http
      .expectOne(
        (request) =>
          request.url === '/api/projects/p1/files' && request.method === 'POST',
      )
      .flush(
        { message: 'This file is already in the project', existing: {} },
        { status: 409, statusText: 'Conflict' },
      );
    expect(await duplicate).toBe(false);
    expect(t.notifications.error).toHaveBeenCalledWith(
      'files.upload.duplicate',
      'kraken-ledger.csv',
    );
  });
});
