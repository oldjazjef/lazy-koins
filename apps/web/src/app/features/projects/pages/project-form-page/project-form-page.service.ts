import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  CreateProjectRequest,
  Project,
} from '../../../../core/api/api.types';

@Injectable({ providedIn: 'root' })
export class ProjectFormPageService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly actions = inject(ActionRunner);

  /** My existing projects — F4.3: country and canton are suggested from the newest one. */
  private readonly existing = httpResource<Project[]>(() =>
    apiUrl('/projects'),
  );

  /** The canton of my newest project (the API lists newest tax year first), if any. */
  readonly suggestedCanton = computed(() =>
    this.existing.hasValue() ? this.existing.value()[0]?.canton : undefined,
  );

  private readonly createAction = defineAction<CreateProjectRequest, Project>({
    run: (request) =>
      firstValueFrom(this.http.post<Project>(apiUrl('/projects'), request)),
    messages: {
      success: 'projects.form.created',
      error: 'projects.form.createFailed',
    },
  });

  private readonly status = this.actions.status<Project>('project-create');
  readonly isSaving = computed(() => this.status()?.state === 'pending');

  async create(request: CreateProjectRequest): Promise<void> {
    const project = await this.actions.run(this.createAction, request, {
      key: 'project-create',
    });
    await this.router.navigate(['/app/projects', project.id], {
      replaceUrl: true,
    });
  }
}
