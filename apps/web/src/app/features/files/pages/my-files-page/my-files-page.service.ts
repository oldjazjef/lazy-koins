import {
  HttpClient,
  HttpErrorResponse,
  type HttpResponse,
  httpResource,
} from '@angular/common/http';
import { computed, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { ActivityService } from '../../../../core/activity/activity.service';
import type {
  FileAssignmentRequest,
  FilePreview,
  Mapping,
  Project,
  SelectFilesResult,
  UserFile,
} from '../../../../core/api/api.types';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { fileNameFrom, saveBlob } from '../../../../shared/files/save-blob';
import { uploadErrorKey } from '../../components/project-files/project-files.service';

/** Upload limit per file (F5.1) — the API refuses larger ones anyway. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** One platform's files, in the order the page shows them (F5.21: grouped by platform). */
export interface FileGroup {
  /** null = no platform (evidence, not read yet). */
  readonly platform: string | null;
  readonly files: readonly UserFile[];
}

/** The projects that block a change (409 `usedByClosedProject`). */
export function closedProjectsOf(error: unknown): string[] {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return [];
  const projects = (error.error as { projects?: unknown } | null)?.projects;
  return Array.isArray(projects)
    ? projects.flatMap((p) =>
        p && typeof p === 'object' && 'name' in p ? [String(p.name)] : [],
      )
    : [];
}

/**
 * "Dateien" in the main navigation (F5.21–F5.23): every file of mine, independent of projects,
 * grouped by platform — upload, read with a mapping / detect / evidence only (for every project
 * that uses it), preview, download, add to a project, delete.
 */
@Injectable({ providedIn: 'root' })
export class MyFilesPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly activity = inject(ActivityService);
  private readonly notifications = inject(NotificationService);
  private readonly changes = inject(DataChanges);
  private readonly document = inject(DOCUMENT);

  readonly files = httpResource<UserFile[]>(() => apiUrl('/files'));
  readonly mappings = httpResource<Mapping[]>(() => apiUrl('/mappings'));
  readonly projects = httpResource<Project[]>(() => apiUrl('/projects'));

  readonly search = signal('');
  readonly platform = signal('');

  readonly isEmpty = computed(
    () => this.files.hasValue() && this.files.value().length === 0,
  );

  readonly platforms = computed(() => {
    const all = this.files.hasValue() ? this.files.value() : [];
    return [
      ...new Set(all.map((f) => f.platform).filter((p) => p !== null)),
    ].sort();
  });

  /** The files on screen: searched, filtered by platform, sorted by platform then name. */
  readonly visible = computed<UserFile[]>(() => {
    const all = this.files.hasValue() ? this.files.value() : [];
    const needle = this.search().trim().toLocaleLowerCase('de-CH');
    const platform = this.platform();
    return all
      .filter(
        (f) =>
          (!platform || f.platform === platform) &&
          (!needle ||
            f.name.toLocaleLowerCase('de-CH').includes(needle) ||
            (f.platform ?? '').toLocaleLowerCase('de-CH').includes(needle) ||
            (f.mappingName ?? '').toLocaleLowerCase('de-CH').includes(needle) ||
            f.usedIn.some((u) =>
              u.projectName.toLocaleLowerCase('de-CH').includes(needle),
            )),
      )
      .sort(
        (a, b) =>
          (a.platform === null ? 1 : 0) - (b.platform === null ? 1 : 0) ||
          (a.platform ?? '').localeCompare(b.platform ?? '') ||
          a.name.localeCompare(b.name),
      );
  });

  /** Open projects a file can be added to. */
  readonly openProjects = computed(() =>
    (this.projects.hasValue() ? this.projects.value() : [])
      .filter((p) => p.status !== 'closed')
      .sort((a, b) => b.taxYear - a.taxYear || a.name.localeCompare(b.name)),
  );

  private readonly assignAction = defineAction<
    { file: UserFile; assignment: FileAssignmentRequest },
    UserFile
  >({
    run: ({ file, assignment }) =>
      firstValueFrom(
        this.http.patch<UserFile>(apiUrl(`/files/${file.id}`), assignment),
      ),
    messages: { success: 'files.assigned', error: 'files.assignFailed' },
  });

  private readonly deleteAction = defineAction<UserFile, void>({
    run: (file) =>
      firstValueFrom(this.http.delete<void>(apiUrl(`/files/${file.id}`))),
    messages: { success: 'myFiles.deleted', error: 'myFiles.deleteFailed' },
  });

  private readonly addAction = defineAction<
    { file: UserFile; projectId: string },
    SelectFilesResult
  >({
    run: ({ file, projectId }) =>
      firstValueFrom(
        this.http.post<SelectFilesResult>(
          apiUrl(`/projects/${projectId}/files/select`),
          { fileIds: [file.id] },
        ),
      ),
    messages: { success: 'myFiles.added', error: 'myFiles.addFailed' },
  });

  private readonly status = this.actions.status<unknown>('my-files');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  /** Reload now and after every change while the page is on screen. */
  follow(): void {
    this.files.reload();
    this.mappings.reload();
    this.projects.reload();
    reloadOn(
      () => this.changes.globalVersion('files'),
      [this.files, this.projects],
    );
    reloadOn(() => this.changes.globalVersion('mappings'), [this.mappings]);
  }

  /** F5.21: several files, one request each; a duplicate or failure is its own toast. */
  async upload(files: readonly File[]): Promise<void> {
    await this.activity.track(
      'activity.upload',
      async () => {
        let added = 0;
        for (const file of files) {
          if (file.size > MAX_FILE_BYTES) {
            this.notifications.error('files.upload.tooBig', file.name);
            continue;
          }
          try {
            await firstValueFrom(
              this.http.post<UserFile>(apiUrl('/files'), file, {
                params: { name: file.name },
                headers: { 'Content-Type': 'application/octet-stream' },
              }),
            );
            added += 1;
          } catch (error) {
            this.notifications.error(uploadErrorKey(error), file.name);
          }
        }
        if (added > 0) {
          this.notifications.info('files.upload.added', { count: added });
        }
      },
      { params: { count: files.length } },
    );
  }

  /** Read with a mapping / detect again / evidence only; blocked by a closed project (409). */
  async assign(
    file: UserFile,
    assignment: FileAssignmentRequest,
  ): Promise<string[]> {
    try {
      await this.actions.run(
        this.assignAction,
        { file, assignment },
        { key: 'my-files' },
      );
      return [];
    } catch (error) {
      return closedProjectsOf(error);
    }
  }

  /** F5.23: deletes the file everywhere; blocked by a closed project (409, names returned). */
  async remove(file: UserFile): Promise<string[]> {
    try {
      await this.actions.run(this.deleteAction, file, { key: 'my-files' });
      return [];
    } catch (error) {
      return closedProjectsOf(error);
    }
  }

  async addToProject(file: UserFile, projectId: string): Promise<void> {
    await this.actions.run(
      this.addAction,
      { file, projectId },
      { key: 'my-files' },
    );
  }

  preview(file: UserFile, rows = 50): Promise<FilePreview> {
    return firstValueFrom(
      this.http.get<FilePreview>(apiUrl(`/files/${file.id}/preview`), {
        params: { rows },
      }),
    );
  }

  async download(file: UserFile): Promise<void> {
    try {
      const response = await this.fetchBlob(file);
      saveBlob(
        this.document,
        response.body ?? new Blob(),
        fileNameFrom(response.headers.get('Content-Disposition'), file.name),
      );
    } catch {
      this.notifications.error('files.downloadFailed');
    }
  }

  /** The original bytes as an object URL (PDF preview); the caller revokes it. */
  async objectUrl(file: UserFile): Promise<string | undefined> {
    try {
      const response = await this.fetchBlob(file);
      return response.body ? URL.createObjectURL(response.body) : undefined;
    } catch {
      this.notifications.error('files.preview.failed');
      return undefined;
    }
  }

  private fetchBlob(file: UserFile): Promise<HttpResponse<Blob>> {
    return firstValueFrom(
      this.http.get(apiUrl(`/files/${file.id}/content`), {
        responseType: 'blob',
        observe: 'response',
      }),
    );
  }
}
