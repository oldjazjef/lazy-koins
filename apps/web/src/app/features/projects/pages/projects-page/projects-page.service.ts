import { httpResource } from '@angular/common/http';
import { computed, Injectable } from '@angular/core';
import { apiUrl } from '../../../../core/api/api-url';
import type { Project } from '../../../../core/api/api.types';

/** F4.2: my projects, newest tax year first (the API sorts). */
@Injectable({ providedIn: 'root' })
export class ProjectsPageService {
  readonly projects = httpResource<Project[]>(() => apiUrl('/projects'));

  readonly isEmpty = computed(
    () => this.projects.hasValue() && this.projects.value().length === 0,
  );

  refresh(): void {
    this.projects.reload();
  }
}
