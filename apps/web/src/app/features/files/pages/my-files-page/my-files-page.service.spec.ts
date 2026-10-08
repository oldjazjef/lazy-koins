import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { UserFile } from '../../../../core/api/api.types';
import { provideAppHttpClient } from '../../../../core/data/testing';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { myFileActions } from './my-files-page';
import { MyFilesPageService } from './my-files-page.service';

const file = (over: Partial<UserFile> = {}): UserFile => ({
  id: 'f1',
  sha256: 'a'.repeat(64),
  name: 'kraken-ledger.csv',
  kind: 'csv',
  size: 2048,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'mapped',
  platform: 'kraken',
  mappingId: 'm1',
  mappingName: 'Kraken Ledger',
  period: { from: '2025-01-01', to: '2025-12-31' },
  bookingCount: 10,
  holdingCount: 0,
  errorCount: 0,
  source: 'uploaded',
  sourceWalletId: null,
  derivedFromFileId: null,
  usedIn: [],
  ...over,
});

const LIST = [
  file({ id: 'f1', name: 'b.csv', platform: 'kraken' }),
  file({ id: 'f2', name: 'a.csv', platform: 'binance' }),
  file({
    id: 'f3',
    name: 'beleg.pdf',
    kind: 'pdf',
    platform: null,
    status: 'evidence_only',
    usedIn: [
      {
        projectFileId: 'pf1',
        projectId: 'p1',
        projectName: 'Steuern 2025',
        taxYear: 2025,
        projectStatus: 'draft',
        active: true,
      },
    ],
  }),
  file({ id: 'f4', name: 'a.csv', platform: 'kraken' }),
];

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup() {
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
  const service = TestBed.inject(MyFilesPageService);
  TestBed.runInInjectionContext(() => service.follow());
  const http = TestBed.inject(HttpTestingController);
  await settle();
  http.expectOne('/api/files').flush(LIST);
  http.expectOne('/api/mappings').flush([]);
  http.expectOne('/api/projects').flush([]);
  await settle();
  return { service, http, notifications };
}

describe('MyFilesPageService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('groups by platform (unread last), then name', async () => {
    const { service } = await setup();
    expect(service.visible().map((f) => f.id)).toEqual([
      'f2',
      'f4',
      'f1',
      'f3',
    ]);
    expect(service.platforms()).toEqual(['binance', 'kraken']);
  });

  it('filters by platform and searches names and projects', async () => {
    const { service } = await setup();
    service.platform.set('kraken');
    expect(service.visible().map((f) => f.id)).toEqual(['f4', 'f1']);
    service.platform.set('');
    service.search.set('steuern');
    expect(service.visible().map((f) => f.id)).toEqual(['f3']);
  });

  it('returns the closed projects that block a delete (409)', async () => {
    const { service, http } = await setup();
    const pending = service.remove(LIST[0] as UserFile);
    await settle();
    http.expectOne('/api/files/f1').flush(
      {
        code: 'usedByClosedProject',
        projects: [{ id: 'p9', name: 'Steuern 2024', taxYear: 2024 }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    expect(await pending).toEqual(['Steuern 2024']);
  });

  it('adds a file to a project through the selection endpoint', async () => {
    const { service, http } = await setup();
    const pending = service.addToProject(LIST[0] as UserFile, 'p1');
    await settle();
    const request = http.expectOne('/api/projects/p1/files/select');
    expect(request.request.body).toEqual({ fileIds: ['f1'] });
    request.flush({ added: 1, alreadySelected: 0 });
    await pending;
  });
});

describe('myFileActions', () => {
  it('offers no mapping assignment for a PDF', () => {
    const actions = (f: UserFile) =>
      myFileActions(f)
        .filter((a) => !a.hidden)
        .map((a) => a.id);
    expect(actions(LIST[2] as UserFile)).not.toContain('assign');
    expect(actions(LIST[0] as UserFile)).toContain('assign');
  });
});
