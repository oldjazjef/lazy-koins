import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  AiSettings,
  ExtractedHolding,
  MappingCandidate,
  ProjectFile,
  ProjectFiles,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { aiErrorKey } from '../../../../shared/ai/ai-error-key';
import { ProjectFilesService } from '../project-files/project-files.service';
import { AiAssistState, confirmed, readablePayload } from './ai-assist.state';

const file = (over: Partial<ProjectFile> = {}): ProjectFile => ({
  id: 'f1',
  sha256: 'a'.repeat(64),
  displayName: 'export.csv',
  kind: 'csv',
  size: 100,
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

const settings = (over: Partial<AiSettings> = {}): AiSettings => ({
  enabled: true,
  provider: 'openai_compatible',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.1',
  hasApiKey: false,
  apiKeyHint: null,
  consentAt: null,
  ready: true,
  canStoreKey: true,
  privateUrlsAllowed: true,
  ...over,
});

const candidate: MappingCandidate = {
  spec: { format: 'lazy-koins-mapping', name: 'Demo' },
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
  kindCounts: { trade: 2, unknown: 1 },
  unknownValues: [{ value: 'Mystery', count: 1 }],
  problems: [],
  rounds: 1,
  model: 'fake',
  usage: { inputTokens: 10, outputTokens: 5 },
};

const holding = (over: Partial<ExtractedHolding> = {}): ExtractedHolding => ({
  asset: 'BTC',
  quantityAsPrinted: '0.5',
  quantity: '0.5',
  asOf: '2025-12-31',
  platform: 'kraken',
  account: 'main',
  priceChf: null,
  priceUsd: null,
  page: 1,
  verbatim: true,
  issues: [],
  ...over,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const BASE = '/api/projects/p1/files/f1/ai';

async function setup(files: ProjectFile[] = [file()]) {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ProjectFilesService,
      AiAssistState,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const filesService = TestBed.inject(ProjectFilesService);
  const state = TestBed.inject(AiAssistState);
  const http = TestBed.inject(HttpTestingController);
  filesService.projectId.set('p1');
  await settle();
  const overview: ProjectFiles = {
    taxYear: 2025,
    groups: [{ platform: null, files }],
    missing: [],
  };
  http.expectOne('/api/projects/p1/files').flush(overview);
  http.expectOne('/api/projects/p1/mappings').flush([]);
  http.expectOne('/api/mappings').flush([]);
  await settle();
  return { state, http, notifications };
}

async function flushReloads(http: HttpTestingController) {
  await settle();
  http.expectOne('/api/projects/p1/files').flush({
    taxYear: 2025,
    groups: [],
    missing: [],
  });
  http.expectOne('/api/projects/p1/mappings').flush([]);
  http.expectOne('/api/mappings').flush([]);
}

describe('AiAssistState', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('explains how to switch the plugin on instead of sending anything', async () => {
    const { state, http } = await setup();
    const started = state.start(file(), 'mapping');
    http.expectOne('/api/ai/settings').flush(settings({ enabled: false }));
    await started;
    expect(state.step()).toBe('notReady');
    expect(state.notReadyReason()).toBe('disabled');

    const again = state.start(file(), 'mapping');
    http
      .expectOne('/api/ai/settings')
      .flush(settings({ ready: false, baseUrl: '' }));
    await again;
    expect(state.notReadyReason()).toBe('notConfigured');
    http.expectNone(`${BASE}/mapping/payload`);
  });

  it('shows the payload, needs consent the first time, then reviews and saves the mapping', async () => {
    const { state, http, notifications } = await setup();
    const started = state.start(file(), 'mapping');
    http.expectOne('/api/ai/settings').flush(settings());
    await settle();
    http.expectOne(`${BASE}/mapping/payload`).flush({
      payload: { fileName: 'export.csv', rows: [['Date', 'Type']] },
      provider: 'openai_compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      consentGiven: false,
    });
    await started;
    expect(state.step()).toBe('consent');
    expect(state.payloadText()).toContain('"fileName": "export.csv"');
    expect(state.canSend()).toBe(false);

    await state.send(); // without consent: nothing is sent
    http.expectNone(`${BASE}/mapping`);

    state.consentChecked.set(true);
    const sent = state.send();
    const request = http.expectOne(`${BASE}/mapping`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ consent: true });
    request.flush(candidate);
    await sent;
    expect(state.step()).toBe('mappingReview');
    expect(state.usage()).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(JSON.parse(state.specText())).toEqual(candidate.spec);

    state.specText.set('{"format":"lazy-koins-mapping","name":"Edited"}');
    const saved = state.saveMapping();
    const accept = http.expectOne(`${BASE}/mapping/accept`);
    expect(accept.request.body).toEqual({
      spec: { format: 'lazy-koins-mapping', name: 'Edited' },
    });
    accept.flush({ mapping: { id: 'm7' }, file: file({ status: 'mapped' }) });
    await saved;
    await flushReloads(http);
    // The toast links to the new mapping's page (F11.0).
    expect(notifications.success).toHaveBeenCalledWith('ai.mapping.saved', {
      labelKey: 'mappings.openPage',
      onClick: expect.any(Function),
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    (
      notifications.success.mock.calls[0]?.[1] as { onClick: () => void }
    ).onClick();
    expect(navigate).toHaveBeenCalledWith(['/app/mappings', 'm7']);
    expect(state.step()).toBe('closed');
  });

  it('keeps invalid JSON and refused specs in the review', async () => {
    const { state, http } = await setup();
    state.file.set(file());
    state.step.set('mappingReview');
    state.specText.set('{nope');
    await state.saveMapping();
    expect(state.invalidJson()).toBe(true);
    http.expectNone(`${BASE}/mapping/accept`);

    state.specText.set('{}');
    const saved = state.saveMapping();
    http
      .expectOne(`${BASE}/mapping/accept`)
      .flush(
        { statusCode: 400, issues: [{ path: 'name', message: 'Required' }] },
        { status: 400, statusText: 'Bad Request' },
      );
    await saved;
    expect(state.issues()).toEqual([{ path: 'name', message: 'Required' }]);
    expect(state.step()).toBe('mappingReview');
  });

  it('translates provider failures and stays on the consent step', async () => {
    const { state, http, notifications } = await setup();
    state.file.set(file());
    state.request.set({
      payload: {},
      provider: 'anthropic',
      baseUrl: '',
      model: '',
      consentGiven: true,
    });
    const sent = state.send();
    http
      .expectOne(`${BASE}/mapping`)
      .flush(
        { statusCode: 502, code: 'invalidKey' },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await sent;
    expect(notifications.error).toHaveBeenCalledWith('ai.errors.invalidKey');
    expect(state.step()).toBe('consent');
  });

  it('reads a PDF statement and stores only the kept balances, as printed', async () => {
    const pdf = file({ kind: 'pdf', status: 'evidence_only' });
    const { state, http, notifications } = await setup([pdf]);
    state.file.set(pdf);
    state.mode.set('statement');
    state.request.set({
      payload: {},
      provider: 'openai_compatible',
      baseUrl: '',
      model: '',
      consentGiven: true,
    });
    const sent = state.send();
    http.expectOne(`${BASE}/statement`).flush({
      holdings: [
        holding({ priceUsdAsPrinted: '97,000.00', priceUsd: '97000.00' }),
        holding({
          asset: 'ETH',
          quantityAsPrinted: 'n/a',
          quantity: null,
          issues: ['invalidNumber', 'notVerbatim'],
        }),
        holding({ asset: 'DOT', quantityAsPrinted: '42.0', quantity: '42.0' }),
      ],
      truncated: false,
      rounds: 1,
      model: 'fake',
      usage: null,
    });
    await sent;
    expect(state.step()).toBe('statementReview');
    // A record without a number is not kept by default.
    expect([...state.kept()]).toEqual([0, 2]);
    state.toggleKept(2);

    const saved = state.saveStatement();
    const accept = http.expectOne(`${BASE}/statement/accept`);
    expect(accept.request.body).toEqual({
      holdings: [
        {
          asset: 'BTC',
          quantityAsPrinted: '0.5',
          asOf: '2025-12-31',
          platform: 'kraken',
          account: 'main',
          priceUsdAsPrinted: '97,000.00',
          page: 1,
        },
      ],
    });
    accept.flush(file({ id: 'f9' }), { status: 201, statusText: 'Created' });
    await saved;
    await flushReloads(http);
    expect(notifications.success).toHaveBeenCalledWith('ai.statement.saved');
  });

  it('starts right away from the mappings section when one file needs a mapping', async () => {
    const { state, http, notifications } = await setup([
      file(),
      file({ id: 'f2', status: 'mapped' }),
    ]);
    state.openPicker();
    http.expectOne('/api/ai/settings').flush(settings({ enabled: false }));
    await settle();
    expect(state.file()?.id).toBe('f1');

    TestBed.resetTestingModule();
    const empty = await setup([file({ status: 'standard' })]);
    empty.state.openPicker();
    expect(empty.notifications.info).toHaveBeenCalledWith('ai.mapping.noFile');
    expect(notifications.info).not.toHaveBeenCalled();
  });
});

describe('confirmed / aiErrorKey', () => {
  it('sends back the printed strings only', () => {
    expect(confirmed(holding())).toEqual({
      asset: 'BTC',
      quantityAsPrinted: '0.5',
      asOf: '2025-12-31',
      platform: 'kraken',
      account: 'main',
      page: 1,
    });
  });

  it('shows a payload row per line, otherwise unchanged', () => {
    const payload = {
      fileName: 'x.csv',
      rows: [
        ['Date', 'Type'],
        ['2025-01-01', 'Buy'],
      ],
      distinctValues: [{ column: 'Type', values: ['Buy', 'Sell'] }],
    };
    const text = readablePayload(payload);
    expect(text).toContain('["Date", "Type"]');
    expect(text).toContain('"values": ["Buy", "Sell"]');
    expect(JSON.parse(text)).toEqual(payload);
  });

  it('falls back to a generic message for unknown failures', () => {
    expect(aiErrorKey(new Error('x'))).toBe('ai.errors.failed');
  });
});
