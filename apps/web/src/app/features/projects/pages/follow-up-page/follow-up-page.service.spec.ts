import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { FollowUpOptions } from '../../../../core/api/dashboard.types';
import { filesByPlatform } from '../../../../shared/files/files-by-platform';
import { FollowUpPageService } from './follow-up-page.service';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const options: FollowUpOptions = {
  source: { id: 'p1', name: 'Steuern 2025', taxYear: 2025, status: 'closed' },
  taxYear: 2026,
  country: 'CH',
  canton: 'ZH',
  existing: [],
  files: [
    {
      projectFileId: 'f1',
      displayName: 'kraken-ledger.csv',
      platform: 'kraken',
      status: 'mapped',
      periodFrom: '2024-01-01',
      periodTo: '2026-03-01',
      preselected: true,
    },
    {
      projectFileId: 'f2',
      displayName: 'kraken-2025.pdf',
      platform: 'kraken',
      status: 'evidence_only',
      periodFrom: null,
      periodTo: null,
      preselected: false,
    },
    {
      projectFileId: 'f3',
      displayName: 'binance.csv',
      platform: 'binance',
      status: 'mapped',
      periodFrom: '2025-01-01',
      periodTo: '2025-12-31',
      preselected: false,
    },
  ],
  walletsAvailable: true,
  wallets: [
    {
      walletId: 'w1',
      label: 'Ledger',
      address: '0x11',
      networks: ['ethereum'],
      preselected: true,
    },
  ],
  corrections: [
    {
      id: 'c1',
      type: 'reclassify',
      data: { type: 'reclassify', bookingId: 'x', kind: 'income_airdrop' },
      reason: 'Airdrop',
      createdAt: '2025-06-01T00:00:00.000Z',
    },
  ],
  openItems: [],
  notes: 'Belege',
};

describe('FollowUpPageService (F4.4a)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  async function setup() {
    TestBed.configureTestingModule({
      providers: [
        FollowUpPageService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
      ],
    });
    const service = TestBed.inject(FollowUpPageService);
    const http = TestBed.inject(HttpTestingController);
    service.projectId.set('p1');
    await settle();
    http.expectOne('/api/projects/p1/follow-up').flush(options);
    await settle();
    service.preselect(options);
    return { service, http };
  }

  it('preselects files reaching into the new year, nothing else; all/none per group', async () => {
    const { service } = await setup();
    expect([...service.selected().files]).toEqual(['f1']);
    expect(service.selected().corrections.size).toBe(0);
    expect(service.summary()).toEqual({
      files: 1,
      wallets: 1,
      corrections: 0,
      openItems: 0,
      notes: true,
    });
    service.setAll('files', true);
    expect(service.selected().files.size).toBe(3);
    service.setAll('files', false);
    service.toggle('corrections', 'c1');
    expect(service.isSelected('corrections', 'c1')).toBe(true);
    expect(filesByPlatform(options.files).map((g) => g.platform)).toEqual([
      'kraken',
      'binance',
    ]);
  });

  it('creates the project with the choice and opens it', async () => {
    const { service, http } = await setup();
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    service.toggle('corrections', 'c1');
    const done = service.create({
      name: 'Steuern 2026',
      taxYear: 2026,
      canton: 'ZH',
    });
    await settle();
    const request = http.expectOne('/api/projects/p1/follow-up');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Steuern 2026',
      taxYear: 2026,
      canton: 'ZH',
      fileIds: ['f1'],
      correctionIds: ['c1'],
      openItemKeys: [],
      notes: true,
      walletIds: ['w1'],
    });
    request.flush({ projectId: 'p9' });
    await done;
    expect(navigate).toHaveBeenCalledWith(['/app/projects', 'p9'], {
      replaceUrl: true,
    });
  });
});
