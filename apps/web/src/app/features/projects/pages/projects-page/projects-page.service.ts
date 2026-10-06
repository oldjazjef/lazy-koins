import { httpResource } from '@angular/common/http';
import { computed, Injectable } from '@angular/core';
import { apiUrl } from '../../../../core/api/api-url';
import type { ProjectListItem } from '../../../../core/api/calculation.types';

/** F4.2: my projects, newest tax year first (the API sorts), with Vermögen and Ertrag. */
@Injectable({ providedIn: 'root' })
export class ProjectsPageService {
  readonly projects = httpResource<ProjectListItem[]>(() =>
    apiUrl('/projects'),
  );

  readonly isEmpty = computed(
    () => this.projects.hasValue() && this.projects.value().length === 0,
  );

  refresh(): void {
    this.projects.reload();
  }
}
