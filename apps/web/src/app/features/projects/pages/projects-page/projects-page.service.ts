import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type { ProjectListItem } from '../../../../core/api/calculation.types';
import type { ImportedProject } from '../../../../core/api/dashboard.types';

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

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly actions = inject(ActionRunner);

  private readonly importAction = defineAction<File, ImportedProject>({
    run: (file) =>
      firstValueFrom(
        this.http.post<ImportedProject>(
          apiUrl('/projects/import-package'),
          file,
          { headers: { 'Content-Type': 'application/octet-stream' } },
        ),
      ),
    messages: {
      success: 'projects.import.done',
      error: 'projects.import.failed',
    },
  });

  private readonly importStatus =
    this.actions.status<unknown>('project-import');
  readonly isImporting = computed(
    () => this.importStatus()?.state === 'pending',
  );

  /** F10.8: a project package becomes a new project, which then opens. */
  async importPackage(file: File): Promise<void> {
    const imported = await this.actions.run(this.importAction, file, {
      key: 'project-import',
    });
    this.projects.reload();
    await this.router.navigate(['/app/projects', imported.projectId]);
  }
}
