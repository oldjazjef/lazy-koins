import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { Project } from '../../../../core/api/api.types';
import { ProjectDetailPageService } from './project-detail-page.service';

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Steuern 2025',
  taxYear: 2025,
  country: 'CH',
  canton: 'ZH',
  status: 'in_progress',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** httpResource issues its request from an effect; a flushed response lands one task later. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup(initial: Project | 'missing') {
  TestBed.configureTestingModule({
    providers: [
      ProjectDetailPageService,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTranslateService(),
    ],
  });
  const service = TestBed.inject(ProjectDetailPageService);
  const http = TestBed.inject(HttpTestingController);
  service.projectId.set('p1');
  await settle();
  const request = http.expectOne('/api/projects/p1');
  if (initial === 'missing') {
    request.flush(
      { statusCode: 404, message: 'No such project' },
      { status: 404, statusText: 'Not Found' },
    );
  } else {
    request.flush(initial);
  }
  // F4.7: the sent status loads alongside the project.
  http.expectOne('/api/projects/p1/sent').flush({ sent: null, changes: [] });
  http.expectOne('/api/projects/p1/carryovers').flush([]);
  await settle();
  return { service, http };
}

describe('ProjectDetailPageService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the project on screen', async () => {
    const { service } = await setup(project());
    expect(service.project.value()?.name).toBe('Steuern 2025');
    expect(service.isClosed()).toBe(false);
    expect(service.notFound()).toBe(false);
  });

  it('ticks off an open item carried over from the previous year (F4.4a)', async () => {
    const { service, http } = await setup(project());
    const carried = {
      id: 'co1',
      projectId: 'p1',
      sourceProjectId: 'p0',
      sourceProjectName: 'Steuern 2024',
      kind: 'open_item' as const,
      ref: null,
      label: 'balanceDiffers',
      data: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      done: false,
      note: '',
    };
    const done = service.setCarriedDone(carried, true);
    await settle();
    const patch = http.expectOne('/api/projects/p1/open-items');
    expect(patch.request.body).toEqual({ key: 'carried:co1', done: true });
    patch.flush({});
    await done;
    await settle();
    http
      .expectOne('/api/projects/p1/carryovers')
      .flush([{ ...carried, done: true }]);
    await settle();
    expect(service.carryovers.value()?.[0]?.done).toBe(true);
  });

  it("shows someone else's (or a missing) project as not found", async () => {
    const { service } = await setup('missing');
    expect(service.notFound()).toBe(true);
  });

  it('saves name, notes and status and shows the result', async () => {
    const { service, http } = await setup(project());
    const done = service.save({ name: 'Neu', notes: 'x', status: 'reviewed' });
    const request = http.expectOne('/api/projects/p1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      name: 'Neu',
      notes: 'x',
      status: 'reviewed',
    });
    request.flush(project({ name: 'Neu', notes: 'x', status: 'reviewed' }));
    await done;
    expect(service.project.value()?.status).toBe('reviewed');
  });

  it('reopens a closed project with a status change only (F4.5)', async () => {
    const { service, http } = await setup(project({ status: 'closed' }));
    expect(service.isClosed()).toBe(true);
    const done = service.reopen();
    const request = http.expectOne('/api/projects/p1');
    expect(request.request.body).toEqual({ status: 'in_progress' });
    request.flush(project({ status: 'in_progress' }));
    await done;
    expect(service.isClosed()).toBe(false);
  });

  it('deletes and goes back to the list', async () => {
    const { service, http } = await setup(project());
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const done = service.remove();
    const request = http.expectOne('/api/projects/p1');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await done;
    expect(navigate).toHaveBeenCalledWith(['/app/projects'], {
      replaceUrl: true,
    });
  });
});
