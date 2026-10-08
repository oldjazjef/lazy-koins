import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { FileCandidate } from '../../../../core/api/api.types';
import { provideAppHttpClient } from '../../../../core/data/testing';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { SelectFilesService } from './select-files.service';

const candidate = (over: Partial<FileCandidate>): FileCandidate => ({
  id: 'f1',
  sha256: 'a'.repeat(64),
  name: 'x.csv',
  kind: 'csv',
  size: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'mapped',
  platform: 'kraken',
  mappingId: null,
  mappingName: null,
  period: null,
  bookingCount: 1,
  holdingCount: 0,
  errorCount: 0,
  source: 'uploaded',
  sourceWalletId: null,
  derivedFromFileId: null,
  usedIn: [],
  selected: false,
  suggested: false,
  ...over,
});

describe('SelectFilesService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('pre-ticks suggested files not in the project yet and posts the choice', async () => {
    const notifications = { error: vi.fn(), info: vi.fn(), success: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideAppHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        SelectFilesService,
        { provide: NotificationService, useValue: notifications },
      ],
    });
    const service = TestBed.inject(SelectFilesService);
    const http = TestBed.inject(HttpTestingController);

    const loading = service.load('p1');
    http
      .expectOne('/api/projects/p1/file-candidates')
      .flush([
        candidate({ id: 'a', suggested: true }),
        candidate({ id: 'b', suggested: true, selected: true }),
        candidate({ id: 'c', name: 'old.csv' }),
      ]);
    await loading;
    expect([...service.selected()]).toEqual(['a']);

    service.onlySuggested.set(true);
    expect(service.visible().map((f) => f.id)).toEqual(['a', 'b']);
    service.onlySuggested.set(false);
    service.search.set('old');
    service.setVisible(true);
    expect([...service.selected()].sort()).toEqual(['a', 'c']);

    const adding = service.add('p1');
    await new Promise((resolve) => setTimeout(resolve));
    const request = http.expectOne('/api/projects/p1/files/select');
    expect(request.request.body.fileIds.sort()).toEqual(['a', 'c']);
    request.flush({ added: 2, alreadySelected: 0 });
    expect(await adding).toBe(2);
    expect(notifications.info).toHaveBeenCalledWith('files.select.done', {
      count: 2,
    });
    http.verify();
  });
});
