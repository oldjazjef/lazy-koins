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
import type { ResultStatus } from '../../../../core/api/calculation.types';
import type { Carryover } from '../../../../core/api/dashboard.types';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';

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

  readonly projectId = signal<string | undefined>(undefined);

  readonly project = httpResource<Project>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}`) : undefined;
  });

  /** F4.7: sent to the Treuhänder; follows sends, marks, exports and calculations. */
  readonly sent = httpResource<ProjectSentStatus>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/sent`) : undefined;
  });

  /** What this project took over, and from where (F4.4, F4.4a, F10.8). */
  readonly carryovers = httpResource<Carryover[]>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/carryovers`) : undefined;
  });

  /** F7.6: "Daten geändert – neu berechnen" in the header, whatever tab is on screen. */
  readonly resultStatus = httpResource<ResultStatus>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/result/status`) : undefined;
  });
  readonly isStale = computed(
    () => this.resultStatus.hasValue() && this.resultStatus.value().stale,
  );

  constructor() {
    // Every change to this project (in the workspace, by the assistant, on the mappings page …)
    // refreshes the header: facts, F4.7 state, carry-overs and the stale line.
    const changes = inject(DataChanges);
    reloadOn(
      () => changes.projectVersion(this.projectId()),
      [this.project, this.sent, this.carryovers, this.resultStatus],
    );
  }

  private readonly carriedItemAction = defineAction<
    { id: string; carryover: Carryover; done: boolean },
    unknown
  >({
    run: ({ id, carryover, done }) =>
      firstValueFrom(
        this.http.patch(apiUrl(`/projects/${id}/open-items`), {
          key: `carried:${carryover.id}`,
          done,
        }),
      ),
    messages: { error: 'checks.saveFailed' },
  });

  /** A carried-over open item ticked off in this project. */
  async setCarriedDone(carryover: Carryover, done: boolean): Promise<void> {
    await this.actions.run(
      this.carriedItemAction,
      { id: this.requireId(), carryover, done },
      { key: `carried:${carryover.id}` },
    );
  }

  private readonly calculateAction = defineAction<string, unknown>({
    run: (id) =>
      firstValueFrom(this.http.post(apiUrl(`/projects/${id}/calculate`), {})),
    messages: {
      success: 'calculation.calculated',
      error: 'calculation.calculateFailed',
    },
  });

  /** Shared with the workspace's buttons (same ActionRunner key). */
  private readonly calculateStatus =
    this.actions.status<unknown>('project-workspace');
  readonly isCalculating = computed(
    () => this.calculateStatus()?.state === 'pending',
  );

  /** "Neu berechnen" from the header; every view follows through DataChanges. */
  async calculate(): Promise<void> {
    await this.actions.run(this.calculateAction, this.requireId(), {
      key: 'project-workspace',
      activity: { label: 'activity.calculate' },
    });
  }

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
