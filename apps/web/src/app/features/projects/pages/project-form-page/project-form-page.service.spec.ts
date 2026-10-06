import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { Project } from '../../../../core/api/api.types';
import { ProjectFormSchema } from './project-form.schema';
import { ProjectFormPageService } from './project-form-page.service';

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Steuern 2025',
  taxYear: 2025,
  country: 'CH',
  canton: 'BE',
  status: 'in_progress',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

describe('ProjectFormPageService', () => {
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

  it('suggests the canton of the newest project (F4.3)', async () => {
    const service = TestBed.inject(ProjectFormPageService);
    await settle();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/projects')
      .flush([project({ canton: 'BE' }), project({ id: 'p0', canton: 'ZH' })]);
    await settle();
    expect(service.suggestedCanton()).toBe('BE');
  });

  it('creates the project and opens it', async () => {
    const service = TestBed.inject(ProjectFormPageService);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await settle();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/projects').flush([]);

    const done = service.create({
      name: 'Steuern 2025',
      taxYear: 2025,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    const request = http.expectOne(
      (r) => r.method === 'POST' && r.url === '/api/projects',
    );
    expect(request.request.body).toMatchObject({ canton: 'ZH', taxYear: 2025 });
    request.flush(project({ id: 'new' }));
    await done;

    expect(navigate).toHaveBeenCalledWith(['/app/projects', 'new'], {
      replaceUrl: true,
    });
  });
});

describe('ProjectFormSchema', () => {
  const valid = {
    name: ' Steuern 2025 ',
    taxYear: 2025,
    canton: 'ZH',
    notes: '',
  };

  it('accepts a complete project and trims the name', () => {
    expect(ProjectFormSchema.parse(valid).name).toBe('Steuern 2025');
  });

  it.each([
    [{ name: '   ' }, 'projects.form.nameRequired'],
    [{ taxYear: 1999 }, 'projects.form.taxYearInvalid'],
    [{ taxYear: 2025.5 }, 'projects.form.taxYearInvalid'],
    [{ canton: '' }, 'projects.form.cantonRequired'],
    [{ canton: 'XX' }, 'projects.form.cantonRequired'],
  ])('rejects %j with an i18n key', (patch, message) => {
    const result = ProjectFormSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});
