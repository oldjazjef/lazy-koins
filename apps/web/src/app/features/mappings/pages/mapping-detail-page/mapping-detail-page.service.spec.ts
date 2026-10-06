import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  Mapping,
  MappingUsageProject,
  SampleInspection,
  SamplePreview,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { MappingWorkbenchService } from '../../components/mapping-workbench';
import { MappingDetailPageService } from './mapping-detail-page.service';

const mapping = (over: Partial<Mapping> = {}): Mapping => ({
  id: 'm1',
  name: 'Kraken Ledger',
  platform: 'kraken',
  fingerprint: 'amount|asset',
  version: 1,
  origin: 'manual',
  spec: { format: 'lazy-koins-mapping', name: 'Kraken Ledger' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const USAGE: MappingUsageProject[] = [
  {
    id: 'p1',
    name: 'Steuern 2025',
    taxYear: 2025,
    status: 'in_progress',
    files: [{ id: 'f1', displayName: 'ledgers.csv', status: 'mapped' }],
  },
  {
    id: 'p2',
    name: 'Steuern 2024',
    taxYear: 2024,
    status: 'closed',
    files: [{ id: 'f2', displayName: 'ledgers-2024.csv', status: 'mapped' }],
  },
];

const INSPECTION: SampleInspection = {
  name: 'ledgers.csv',
  kind: 'csv',
  size: 12,
  sample: {
    fileName: 'ledgers.csv',
    fileKind: 'csv',
    rowCount: 2,
    headerRowGuess: 1,
    rows: [
      ['time', 'amount'],
      ['2025-01-01', '1'],
    ],
    distinctValues: [],
  },
  skeleton: { format: 'lazy-koins-mapping' },
  recognisedBy: { standard: false, mapping: null },
};

const LIVE: SamplePreview = {
  valid: true,
  issues: [],
  preview: {
    bookings: [],
    holdings: [],
    errors: [],
    notes: [],
    period: null,
    totals: { bookings: 13, holdings: 9, errors: 0, notes: 0 },
  },
  kindCounts: { trade: 13 },
  unknownValues: [],
  fingerprint: {
    verdict: 'this',
    confidence: 1,
    recognisedBy: { standard: false, mapping: null },
  },
};
/** httpResource issues its request from an effect; a flushed response lands one task later. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup(
  initial: Mapping | 'missing' = mapping(),
  usage: MappingUsageProject[] = USAGE,
) {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      MappingDetailPageService,
      MappingWorkbenchService,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(MappingDetailPageService);
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  service.mappingId.set('m1');
  await settle();
  const request = http.expectOne('/api/mappings/m1');
  if (initial === 'missing') {
    request.flush(
      { statusCode: 404, message: 'No such mapping' },
      { status: 404, statusText: 'Not Found' },
    );
    http
      .expectOne('/api/mappings/m1/usage')
      .flush({ statusCode: 404 }, { status: 404, statusText: 'Not Found' });
  } else {
    request.flush(initial);
    http.expectOne('/api/mappings/m1/usage').flush(usage);
  }
  await settle();
  return { service, http, notifications, navigate };
}

describe('MappingDetailPageService', () => {
  afterEach(() => {
    try {
      const http = TestBed.inject(HttpTestingController);
      // The workbench loads my project list in the background once a sample is there.
      http.match('/api/projects');
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the mapping and where it is used', async () => {
    const { service } = await setup();
    expect(service.mapping.value()?.name).toBe('Kraken Ledger');
    expect(service.filesUsing()).toBe(2);
    expect(service.closedFiles()).toBe(1);
    expect(service.usedByClosedProject()).toBe(true);
    expect(service.notFound()).toBe(false);
  });

  it("shows someone else's (or a missing) mapping as not found", async () => {
    const { service } = await setup('missing');
    expect(service.notFound()).toBe(true);
  });

  it('edits with a file that uses it as the sample, then offers to re-apply', async () => {
    const { service, http, notifications } = await setup();
    const workbench = TestBed.inject(MappingWorkbenchService);
    service.startEdit();
    expect(service.editing()).toBe(true);
    expect(JSON.parse(workbench.text())).toEqual(mapping().spec);

    // The first file that uses the mapping becomes the sample: its bytes, then the live preview.
    http
      .expectOne('/api/projects/p1/files/f1/content')
      .flush(new Blob(['time,amount\n2025-01-01,1']));
    await settle();
    http.expectOne('/api/mapping-samples/inspect').flush(INSPECTION);
    await settle();
    const preview = http.expectOne('/api/mapping-samples/preview');
    const form = preview.request.body as FormData;
    expect(form.get('mappingId')).toBe('m1');
    expect(form.get('name')).toBe('ledgers.csv');
    preview.flush(LIVE);
    await settle();
    expect(workbench.sample()?.from).toEqual({ projectName: 'Steuern 2025' });
    expect(workbench.live()?.fingerprint?.verdict).toBe('this');
    // A stored spec is not pristine-replaced by the skeleton.
    expect(JSON.parse(workbench.text())).toEqual(mapping().spec);

    workbench.text.set('{"format":"lazy-koins-mapping","name":"Edited"}');
    const refused = service.save();
    http
      .expectOne('/api/mappings/m1')
      .flush(
        { issues: [{ path: 'platform', message: 'Required' }] },
        { status: 400, statusText: 'Bad Request' },
      );
    await refused;
    expect(workbench.issues()).toEqual([
      { path: 'platform', message: 'Required' },
    ]);
    expect(service.editing()).toBe(true);

    const saving = service.save();
    const put = http.expectOne('/api/mappings/m1');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({
      spec: { format: 'lazy-koins-mapping', name: 'Edited' },
    });
    put.flush({ mapping: mapping({ name: 'Edited' }), filesUsing: 2 });
    await saving;
    expect(service.editing()).toBe(false);
    expect(service.mapping.value()?.name).toBe('Edited');
    expect(service.reapplyOffer()).toBe(2);

    // Re-applying: the API skips the closed project's file — the message says so.
    const reapplying = service.reapply();
    http
      .expectOne('/api/mappings/m1/reapply')
      .flush({ reapplied: 1, skippedClosed: 1 });
    await reapplying;
    expect(service.reapplyOffer()).toBeNull();
    expect(notifications.info).toHaveBeenCalledWith(
      'mappings.detail.reappliedSkipped',
      { reapplied: 1, skipped: 1 },
    );
    await settle();
    http.expectOne('/api/mappings/m1/usage').flush(USAGE);
  });
  it('deletes and goes back to the list; a closed project refuses it (409)', async () => {
    const { service, http, notifications, navigate } = await setup();
    const refused = service.remove();
    http
      .expectOne('/api/mappings/m1')
      .flush(
        { message: 'A closed project uses this mapping' },
        { status: 409, statusText: 'Conflict' },
      );
    await refused;
    expect(notifications.error).toHaveBeenCalledWith(
      'mappings.detail.deleteClosed',
    );
    expect(navigate).not.toHaveBeenCalled();

    const removing = service.remove();
    const del = http.expectOne('/api/mappings/m1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    await removing;
    expect(notifications.success).toHaveBeenCalledWith(
      'mappings.detail.deleted',
    );
    expect(navigate).toHaveBeenCalledWith(['/app/mappings'], {
      replaceUrl: true,
    });
  });
});
