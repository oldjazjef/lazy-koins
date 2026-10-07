import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AssistantEvents } from '../../../../core/assistant/assistant-events';
import { ProjectSentEvents } from '../../../../shared/mail/project-sent-events';
import { ProjectDashboardCard } from './project-dashboard-card';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const VIEW = {
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

const isDashboard = (req: { url: string }) => req.url.endsWith('/dashboard');

/** Regression (07.10.2026): after "Neu berechnen" the project's chart kept the old values. */
describe('ProjectDashboardCard', () => {
  async function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
      ],
    });
    const fixture = TestBed.createComponent(ProjectDashboardCard);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('taxYear', 2025);
    const http = TestBed.inject(HttpTestingController);
    await settle();
    // The first load (the shared service may first ask for its default period); answered, so a
    // later reload is a new request rather than a no-op on a pending one.
    const first = http.match(isDashboard);
    expect(first.length).toBeGreaterThan(0);
    for (const req of first) if (!req.cancelled) req.flush(VIEW);
    await settle();
    return { http };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('reloads after the workspace recalculated (or exported)', async () => {
    const { http } = await setup();
    TestBed.inject(ProjectSentEvents).changed();
    await settle();
    expect(http.match(isDashboard)).toHaveLength(1);
  });

  it('reloads after the assistant changed this project, not another one', async () => {
    const { http } = await setup();
    const events = TestBed.inject(AssistantEvents);
    events.changed('other');
    await settle();
    expect(http.match(isDashboard)).toHaveLength(0);
    events.changed('p1');
    await settle();
    expect(http.match(isDashboard)).toHaveLength(1);
  });
});
