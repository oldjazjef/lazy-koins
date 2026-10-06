import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  Project,
  UpdateProjectRequest,
} from '../../../../core/api/api.types';
import type { ProjectSentStatus } from '../../../../core/api/mail.types';
import { ProjectSentEvents } from '../../../../shared/mail/project-sent-events';

/**
 * Page-scoped: the project on screen (provided by the page, keyed by the route's id). The API
 * decides what is allowed — a closed project only reopens (F4.5) — and answers someone else's
 * project with 404.
 */
@Injectable()
export class ProjectDetailPageService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly actions = inject(ActionRunner);
  private readonly sentEvents = inject(ProjectSentEvents);

  readonly projectId = signal<string | undefined>(undefined);

  readonly project = httpResource<Project>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}`) : undefined;
  });

  /** F4.7: sent to the Treuhänder; follows sends, marks, exports and calculations. */
  readonly sent = httpResource<ProjectSentStatus>(() => {
    this.sentEvents.version();
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/sent`) : undefined;
  });

  /** F4.5: read-only while closed. */
  readonly isClosed = computed(
    () => this.project.hasValue() && this.project.value().status === 'closed',
  );

  readonly notFound = computed(() => {
    const error = this.project.error() as { status?: number } | undefined;
    return error?.status === 404;
  });

  private readonly updateAction = defineAction<
    { id: string; changes: UpdateProjectRequest },
    Project
  >({
    run: ({ id, changes }) =>
      firstValueFrom(
        this.http.patch<Project>(apiUrl(`/projects/${id}`), changes),
      ),
    messages: {
      success: 'projects.detail.saved',
      error: 'projects.detail.saveFailed',
    },
  });

  private readonly reopenAction = defineAction<string, Project>({
    run: (id) =>
      firstValueFrom(
        this.http.patch<Project>(apiUrl(`/projects/${id}`), {
          status: 'in_progress',
        } satisfies UpdateProjectRequest),
      ),
    messages: {
      success: 'projects.detail.reopened',
      error: 'projects.detail.saveFailed',
    },
  });

  private readonly deleteAction = defineAction<string, void>({
    run: (id) =>
      firstValueFrom(this.http.delete<void>(apiUrl(`/projects/${id}`))),
    messages: {
      success: 'projects.detail.deleted',
      error: 'projects.detail.deleteFailed',
    },
  });

  private readonly status = this.actions.status<unknown>('project-detail');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  async save(changes: UpdateProjectRequest): Promise<void> {
    const id = this.requireId();
    const updated = await this.actions.run(
      this.updateAction,
      { id, changes },
      { key: 'project-detail' },
    );
    this.project.set(updated);
  }

  async reopen(): Promise<void> {
    const updated = await this.actions.run(
      this.reopenAction,
      this.requireId(),
      {
        key: 'project-detail',
      },
    );
    this.project.set(updated);
  }

  async remove(): Promise<void> {
    await this.actions.run(this.deleteAction, this.requireId(), {
      key: 'project-detail',
    });
    await this.router.navigate(['/app/projects'], { replaceUrl: true });
  }

  private requireId(): string {
    const id = this.projectId();
    if (!id) throw new Error('No project on screen');
    return id;
  }
}
