import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { ProjectWallets } from '../../../../core/api/wallets.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { ProjectWalletsService } from './project-wallets.service';

const P = 'p1';
const W = 'w1';

const overview = (): ProjectWallets => ({
  yearEnd: '2025-12-31',
  wallets: [],
  available: [{ id: W, label: 'Ledger', address: '0x11' }],
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      ProjectWalletsService,
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(ProjectWalletsService);
  const http = TestBed.inject(HttpTestingController);
  service.projectId.set(P);
  await settle();
  http.expectOne(`/api/projects/${P}/wallets`).flush(overview());
  http.expectOne(`/api/projects/${P}/files`).flush({
    taxYear: 2025,
    missing: [],
    groups: [
      {
        platform: null,
        files: [
          { id: 'f-pdf', displayName: 'beleg.pdf', status: 'evidence_only' },
          { id: 'f-csv', displayName: 'x.csv', status: 'standard' },
        ],
      },
    ],
  });
  await settle();
  return { service, http, notifications };
}

describe('ProjectWalletsService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('offers only PDFs (evidence) as receipts', async () => {
    const { service } = await setup();
    expect(service.receipts().map((f) => f.id)).toEqual(['f-pdf']);
  });

  it('adds a wallet to the project and reloads', async () => {
    const { service, http, notifications } = await setup();
    const adding = service.add(W);
    const request = http.expectOne(`/api/projects/${P}/wallets`);
    expect(request.request.body).toEqual({ walletId: W });
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(await adding).toBe(true);
    expect(notifications.success).toHaveBeenCalledWith('wallets.project.added');
    await settle();
    http.expectOne(`/api/projects/${P}/wallets`).flush(overview());
  });

  it('records a manual balance with its receipt (F6.5)', async () => {
    const { service, http } = await setup();
    const saving = service.addBalance(W, {
      network: 'cardano',
      asset: 'ADA',
      quantity: '1250.5',
      evidenceFileId: 'f-pdf',
    });
    const request = http.expectOne(`/api/projects/${P}/wallets/${W}/balances`);
    expect(request.request.body).toMatchObject({ quantity: '1250.5' });
    request.flush({});
    expect(await saving).toBe(true);
    await settle();
    http.expectOne(`/api/projects/${P}/wallets`).flush(overview());
  });

  it('shows the code of a failed fetch', async () => {
    const { service, http, notifications } = await setup();
    const fetching = service.fetch(W);
    http
      .expectOne(`/api/wallets/${W}/fetch`)
      .flush({ code: 'offline' }, { status: 409, statusText: 'Conflict' });
    expect(await fetching).toBe(false);
    expect(notifications.error).toHaveBeenCalledWith(
      'wallets.errors.offline',
      undefined,
    );
  });
});
