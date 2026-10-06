import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { Project } from '../../../../core/api/api.types';
import { ProjectsPageService } from './projects-page.service';

const project = (id: string, taxYear: number): Project => ({
  id,
  name: `Steuern ${taxYear}`,
  taxYear,
  country: 'CH',
  canton: 'ZH',
  taxCurrency: 'CHF',
  status: 'in_progress',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** httpResource issues its request from an effect; a flushed response lands one task later. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

describe('ProjectsPageService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('loads my projects from the API', async () => {
    const service = TestBed.inject(ProjectsPageService);
    await settle();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/projects')
      .flush([project('p2', 2025), project('p1', 2024)]);
    await settle();

    expect(service.projects.value()?.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(service.isEmpty()).toBe(false);
  });

  it('knows when there is nothing yet', async () => {
    const service = TestBed.inject(ProjectsPageService);
    await settle();
    TestBed.inject(HttpTestingController).expectOne('/api/projects').flush([]);
    await settle();

    expect(service.isEmpty()).toBe(true);
  });
});
