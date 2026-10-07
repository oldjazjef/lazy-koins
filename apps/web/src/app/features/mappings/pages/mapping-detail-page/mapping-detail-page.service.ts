import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
  type HttpResponse,
} from '@angular/common/http';
import { computed, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import type {
  Mapping,
  MappingUsageProject,
  ProjectStatus,
  ReapplyResult,
  UpdatedMapping,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { fileNameFrom, saveBlob } from '../../../../shared/files/save-blob';
import { parseSpecText } from '../../../files/components/mapping-editor';
import { MappingWorkbenchService } from '../../components/mapping-workbench';
import { specIssues } from '../mappings-page/mappings-page.service';

/** A file read with the mapping, with its project (the editor's preview, the delete dialog). */
export interface UsageFile {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectStatus: ProjectStatus;
  readonly fileId: string;
  readonly displayName: string;
}

/**
 * Page-scoped: one mapping (F11.0) — facts, JSON, editor with a sample file and live preview (a
 * file that uses it is loaded as the sample), re-apply after saving (closed projects are skipped
 * by the API), download, delete (its files go back to "needs mapping"; refused while a closed
 * project uses it), and "Wird genutzt in".
 * Someone else's mapping is a 404, like a missing one.
 */
@Injectable()
export class MappingDetailPageService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);

  readonly mappingId = signal<string | undefined>(undefined);

  readonly mapping = httpResource<Mapping>(() => {
    const id = this.mappingId();
    return id ? apiUrl(`/mappings/${id}`) : undefined;
  });

  readonly usage = httpResource<MappingUsageProject[]>(() => {
    const id = this.mappingId();
    return id ? apiUrl(`/mappings/${id}/usage`) : undefined;
  });

  constructor() {
    // "Wird genutzt in" follows re-applies and files added/removed in any project. The mapping
    // itself is not reloaded under the open editor — this page is where it is changed.
    const changes = inject(DataChanges);
    reloadOn(
      () =>
        changes.globalVersion('mappings') + changes.globalVersion('projects'),
      [this.usage],
    );
  }

  readonly notFound = computed(() => {
    const error = this.mapping.error() as { status?: number } | undefined;
    return error?.status === 404;
  });

  /** The fingerprint's columns, readable (`a|b` → `a, b`). */
  readonly columns = computed(() =>
    this.mapping.hasValue()
      ? this.mapping.value().fingerprint.split('|').join(', ')
      : '',
  );

  readonly usageFiles = computed<UsageFile[]>(() =>
    (this.usage.hasValue() ? this.usage.value() : []).flatMap((project) =>
      project.files.map((file) => ({
        projectId: project.id,
        projectName: project.name,
        projectStatus: project.status,
        fileId: file.id,
        displayName: file.displayName,
      })),
    ),
  );

  readonly filesUsing = computed(() => this.usageFiles().length);
  readonly closedFiles = computed(
    () =>
      this.usageFiles().filter((file) => file.projectStatus === 'closed')
        .length,
  );
  /** F4.5: the API refuses deleting while a closed project holds such a file. */
  readonly usedByClosedProject = computed(() => this.closedFiles() > 0);

  // --- Editor (with a sample file: `MappingWorkbenchService`) ---

  private readonly workbench = inject(MappingWorkbenchService);
  readonly editing = signal(false);
  readonly busy = signal(false);
  /** After saving: how many files could be re-read with the new version. */
  readonly reapplyOffer = signal<number | null>(null);
  private readonly reapplyAction = defineAction<string, ReapplyResult>({
    run: (id) =>
      firstValueFrom(
        this.http.post<ReapplyResult>(apiUrl(`/mappings/${id}/reapply`), {}),
      ),
    messages: { error: 'mappings.reapplyFailed' },
  });

  private readonly deleteAction = defineAction<string, void>({
    run: (id) =>
      firstValueFrom(this.http.delete<void>(apiUrl(`/mappings/${id}`))),
    messages: { success: 'mappings.detail.deleted' },
  });

  private readonly status = this.actions.status<unknown>('mapping-detail');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  /**
   * Opens the editor with the stored spec; the first file that uses the mapping (any project) is
   * loaded as the sample, so the live preview starts right away.
   */
  startEdit(): void {
    if (!this.mapping.hasValue()) return;
    const mapping = this.mapping.value();
    this.workbench.start(JSON.stringify(mapping.spec, null, 2), mapping.id);
    this.editing.set(true);
    const first = this.usageFiles()[0];
    if (first) {
      void this.workbench.useProjectFile(
        first.projectId,
        { id: first.fileId, displayName: first.displayName },
        first.projectName,
      );
    }
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  /** Saves the edited spec; when files use the mapping, offers to re-read them. */
  async save(): Promise<void> {
    const parsed = parseSpecText(this.workbench.text());
    const id = this.mappingId();
    if (!parsed || !id) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.http.put<UpdatedMapping>(apiUrl(`/mappings/${id}`), {
          spec: parsed.value,
        }),
      );
      this.mapping.set(updated.mapping);
      this.editing.set(false);
      this.notifications.success('mappings.saved');
      if (updated.filesUsing > 0) this.reapplyOffer.set(updated.filesUsing);
    } catch (error) {
      const issues = specIssues(error);
      if (issues) this.workbench.saveIssues.set(issues);
      else this.notifications.error('mappings.saveFailed');
    } finally {
      this.busy.set(false);
    }
  }
  /** Re-reads every file of the mapping; files in closed projects stay as they were (F4.5). */
  async reapply(): Promise<void> {
    const id = this.mappingId();
    this.reapplyOffer.set(null);
    if (!id) return;
    try {
      const result = await this.actions.run(this.reapplyAction, id, {
        key: 'mapping-detail',
        activity: { label: 'activity.reapply' },
      });
      this.notifications.info(
        result.skippedClosed > 0
          ? 'mappings.detail.reappliedSkipped'
          : 'mappings.detail.reapplied',
        { reapplied: result.reapplied, skipped: result.skippedClosed },
      );
    } catch {
      // The runner has shown the failure.
    }
  }

  declineReapply(): void {
    this.reapplyOffer.set(null);
  }

  async download(): Promise<void> {
    const id = this.mappingId();
    if (!id) return;
    try {
      const response: HttpResponse<Blob> = await firstValueFrom(
        this.http.get(apiUrl(`/mappings/${id}/download`), {
          responseType: 'blob',
          observe: 'response',
        }),
      );
      saveBlob(
        this.document,
        response.body ?? new Blob(),
        fileNameFrom(
          response.headers.get('Content-Disposition'),
          `${this.mapping.value()?.name ?? 'mapping'}.json`,
        ),
      );
    } catch {
      this.notifications.error('files.downloadFailed');
    }
  }

  /** Deletes the mapping (its files need a mapping again) and goes back to the list. */
  async remove(): Promise<void> {
    const id = this.mappingId();
    if (!id) return;
    try {
      await this.actions.run(this.deleteAction, id, { key: 'mapping-detail' });
    } catch (error) {
      this.notifications.error(
        error instanceof HttpErrorResponse && error.status === 409
          ? 'mappings.detail.deleteClosed'
          : 'mappings.detail.deleteFailed',
      );
      return;
    }
    await this.router.navigate(['/app/mappings'], { replaceUrl: true });
  }
}
