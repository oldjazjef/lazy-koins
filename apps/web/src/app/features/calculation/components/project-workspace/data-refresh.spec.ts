import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { provideAppHttpClient } from '../../../../core/data/testing';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { DashboardPageService } from '../../../dashboard/pages/dashboard-page/dashboard-page.service';
import { ProjectFilesService } from '../../../files/components/project-files/project-files.service';
import { ProjectWorkspaceService } from './project-workspace.service';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const EMPTY_FILES = { taxYear: 2025, groups: [], missing: [] };
const HINTS = { taxYear: 2025, hints: [], open: 0 };
const RESULT = (stale: boolean) => ({
  snapshot: null,
  stale,
  result: null,
  files: [],
});
const DASHBOARD = {
  currency: 'CHF',
  currencies: ['CHF'],
  from: '2025-01-01',
  to: '2025-12-31',
  series: [],
  startValueChf: '0',
  endValueChf: '0',
  changeChf: '0',
  changePct: null,
  kpis: [],
  incomeSharePct: null,
  allocation: [],
  holdings: [],
  missingPrices: [],
  projects: [],
};

/**
 * User rule (08.10.2026): „nach Entfernen von Dateien usw. — Änderungen sollen alles updaten“.
 * The project page's services side by side, as the app wires them: removing a file refetches the
 * files, the hints, the result ("veraltet") and the dashboard card — and nothing that is not on
 * screen (the checks tab is not shown).
 */
describe('one change refreshes every view of the project', () => {
  it('a file removed: files, hints, result and dashboard card refetch; hidden tabs do not', async () => {
    TestBed.configureTestingModule({
      providers: [
        ProjectFilesService,
        ProjectWorkspaceService,
        DashboardPageService,
        provideAppHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
      ],
    });
    const files = TestBed.inject(ProjectFilesService);
    const workspace = TestBed.inject(ProjectWorkspaceService);
    const dashboard = TestBed.inject(DashboardPageService);
    const http = TestBed.inject(HttpTestingController);
    files.projectId.set('p1');
    workspace.projectId.set('p1');
    dashboard.projectId.set('p1');
    dashboard.setCustom({ from: '2025-01-01', to: '2025-12-31' });
    await settle();

    const loadAll = (stale: boolean) => {
      http.expectOne('/api/projects/p1/files').flush(EMPTY_FILES);
      http.expectOne('/api/projects/p1/hints').flush(HINTS);
      http.expectOne('/api/projects/p1/mappings').flush([]);
      http
        .expectOne('/api/projects/p1/mapping-suggestions')
        .flush({ files: [], library: 'off' });
      http.expectOne('/api/projects/p1/result').flush(RESULT(stale));
      http.expectOne((r) => r.url === '/api/dashboard').flush(DASHBOARD);
    };
    loadAll(false);
    http.expectOne('/api/mappings').flush([]);
    await settle();
    expect(workspace.result.value()?.stale).toBe(false);

    const removing = files.remove({ id: 'f1' } as never);
    http.expectOne('/api/projects/p1/files/f1').flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await removing;
    await settle();
    // Everything on screen reloads once; the result now says "Daten geändert".
    loadAll(true);
    // Not on screen / not affected: the checks tab, my mappings.
    http.expectNone('/api/projects/p1/checks');
    http.expectNone('/api/mappings');
    await settle();
    expect(workspace.result.value()?.stale).toBe(true);
    http.verify();
  });
});
