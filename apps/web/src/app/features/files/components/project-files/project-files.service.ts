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
import { LanguageService } from '../../../../core/i18n/language.service';
import {
  type ActivityProgress,
  ActivityService,
} from '../../../../core/activity/activity.service';
import type {
  FileAssignmentRequest,
  FilePreview,
  FileRowErrors,
  HintStatus,
  ProjectHint,
  ProjectHints,
  Mapping,
  MappingPreview,
  MappingSuggestion,
  ProjectFile,
  ProjectFiles,
  ProjectFileStatus,
  ProjectMapping,
  ProjectSuggestions,
  SetFileActiveRequest,
  SpecIssue,
  StandardMapping,
  SuggestionPreview,
  TakenStandardMapping,
  LibraryEntryDetail,
} from '../../../../core/api/api.types';
import { LibraryClient } from '../../../library/library-client';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { fileNameFrom, saveBlob } from '../../../../shared/files/save-blob';

/** Mirrors the API's limit (files/domain/project-file.ts) so oversized files fail fast. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed';

export interface UploadItem {
  readonly id: number;
  readonly name: string;
  readonly state: UploadState;
  /** Once stored: the project file and how it was read (F5.19: `needs_mapping` → a suggestion). */
  readonly fileId?: string;
  readonly status?: ProjectFileStatus;
}

export type TemplateKind = 'bookings' | 'holdings' | 'xlsx';

/** The outcome of checking a spec against a file: the preview, or the schema issues. */
export type SpecCheck =
  | { readonly ok: true; readonly preview: MappingPreview }
  | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/**
 * The files area of one project (F5) and the mappings it uses — provided by the section
 * component, keyed by the project id. The API decides everything (detection, duplicates, closed
 * projects); this service moves bytes and maps answers to translated messages.
 */
@Injectable()
export class ProjectFilesService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly activity = inject(ActivityService);
  private readonly language = inject(LanguageService);
  private readonly library = inject(LibraryClient);

  readonly projectId = signal<string | undefined>(undefined);

  readonly overview = httpResource<ProjectFiles>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/files`) : undefined;
  });

  /** F5.8 "Hinweise" — the tab, its badge and the summary in the files area share it. */
  readonly hints = httpResource<ProjectHints>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/hints`) : undefined;
  });
  readonly openHints = computed(() =>
    this.hints.hasValue() ? this.hints.value().open : 0,
  );

  /** A file whose mapping assignment the files area should open (set from a hint). */
  readonly pendingAssign = signal<string | null>(null);
  /** The platform the hints table is filtered to (set from a link in the checks). */
  readonly hintPlatform = signal<string | null>(null);

  readonly projectMappings = httpResource<ProjectMapping[]>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/mappings`) : undefined;
  });

  /** All my mappings — the choice when assigning one to a file. */
  readonly myMappings = httpResource<Mapping[]>(() =>
    this.projectId() ? apiUrl('/mappings') : undefined,
  );

  /**
   * F5.19: for every file that needs a mapping, the ranked suggestions (my mappings incl. near
   * matches, the standard mappings, the library where available). Shared by the files card,
   * the upload list and the assignment dialog; follows every change to the project.
   */
  readonly suggestions = httpResource<ProjectSuggestions>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/mapping-suggestions`) : undefined;
  });
  readonly suggestionsByFile = computed(
    () =>
      new Map(
        (this.suggestions.hasValue() ? this.suggestions.value().files : []).map(
          (file) => [file.projectFileId, file] as const,
        ),
      ),
  );

  constructor() {
    // A file added/removed/reassigned, a mapping edited or re-applied (here or on the mappings
    // page), a wallet fetched, a hint settled, the assistant: the files area and the hints follow.
    const changes = inject(DataChanges);
    reloadOn(
      () => changes.projectVersion(this.projectId()),
      [this.overview, this.hints, this.projectMappings, this.suggestions],
    );
    reloadOn(
      () => changes.globalVersion('mappings'),
      [this.myMappings, this.suggestions],
    );
  }

  readonly files = computed<ProjectFile[]>(() =>
    this.overview.hasValue()
      ? this.overview.value().groups.flatMap((group) => group.files)
      : [],
  );

  readonly tableFiles = computed(() =>
    this.files().filter((file) => file.kind !== 'pdf'),
  );

  /** F5.7a: how many files of the project are deactivated ("2 deaktiviert"). */
  readonly disabledCount = computed(
    () => this.files().filter((file) => file.active === false).length,
  );

  private readonly uploadQueue = signal<UploadItem[]>([]);
  readonly uploads = this.uploadQueue.asReadonly();
  readonly uploading = computed(() =>
    this.uploadQueue().some(
      (item) => item.state === 'queued' || item.state === 'uploading',
    ),
  );
  /** 0 … 100 over the current batch. */
  readonly uploadProgress = computed(() => {
    const items = this.uploadQueue();
    if (items.length === 0) return 0;
    const finished = items.filter(
      (item) => item.state === 'done' || item.state === 'failed',
    ).length;
    return Math.round((finished / items.length) * 100);
  });

  private seq = 0;

  private readonly removeAction = defineAction<ProjectFile, void>({
    run: (file) =>
      firstValueFrom(
        this.http.delete<void>(
          apiUrl(`/projects/${this.requireId()}/files/${file.id}`),
        ),
      ),
    messages: { success: 'files.removed', error: 'files.removeFailed' },
  });

  private readonly assignAction = defineAction<
    { file: ProjectFile; assignment: FileAssignmentRequest },
    ProjectFile
  >({
    run: ({ file, assignment }) =>
      firstValueFrom(
        this.http.patch<ProjectFile>(
          apiUrl(`/projects/${this.requireId()}/files/${file.id}`),
          assignment,
        ),
      ),
    messages: { success: 'files.assigned', error: 'files.assignFailed' },
  });

  /** F5.7a: "Deaktivieren" (optional note) / "Aktivieren" — one action per toast. */
  private readonly deactivateAction = this.activeAction(
    'files.disabled.deactivated',
  );
  private readonly activateAction = this.activeAction(
    'files.disabled.activated',
  );

  private activeAction(success: string) {
    return defineAction<
      { file: ProjectFile; body: SetFileActiveRequest },
      ProjectFile
    >({
      run: ({ file, body }) =>
        firstValueFrom(
          this.http.patch<ProjectFile>(
            apiUrl(`/projects/${this.requireId()}/files/${file.id}/active`),
            body,
          ),
        ),
      messages: { success, error: 'files.disabled.failed' },
    });
  }

  private readonly hintAction = defineAction<
    { key: string; status: HintStatus; note: string },
    unknown
  >({
    run: (body) =>
      firstValueFrom(
        this.http.patch(apiUrl(`/projects/${this.requireId()}/hints`), body),
      ),
    messages: { error: 'hints.saveFailed' },
  });

  private readonly busyStatus = this.actions.status<unknown>('project-files');
  readonly isBusy = computed(() => this.busyStatus()?.state === 'pending');

  /** Upload progress for the activity indicator ("Dateien werden hochgeladen (2/5)"). */
  private readonly uploadActivity = computed<ActivityProgress | null>(() => {
    const items = this.uploadQueue();
    if (items.length < 2) return null;
    return {
      done: items.filter((i) => i.state === 'done' || i.state === 'failed')
        .length,
      total: items.length,
    };
  });

  /** F5.1: several files, one request each, in order; every failure is its own toast. */
  async upload(files: readonly File[]): Promise<void> {
    await this.activity.track('activity.upload', () => this.uploadAll(files), {
      params: { count: files.length },
      progress: this.uploadActivity,
    });
  }

  private async uploadAll(files: readonly File[]): Promise<void> {
    const projectId = this.requireId();
    const batch = files.map((file) => ({
      id: ++this.seq,
      name: file.name,
      state: 'queued' as UploadState,
    }));
    this.uploadQueue.set(batch);
    let added = 0;
    for (const [index, file] of files.entries()) {
      const item = batch[index];
      if (!item) continue;
      if (file.size > MAX_FILE_BYTES) {
        this.notifications.error('files.upload.tooBig', file.name);
        this.setState(item.id, 'failed');
        continue;
      }
      this.setState(item.id, 'uploading');
      try {
        const stored = await firstValueFrom(
          this.http.post<ProjectFile>(
            apiUrl(`/projects/${projectId}/files`),
            file,
            {
              params: { name: file.name },
              headers: { 'Content-Type': 'application/octet-stream' },
            },
          ),
        );
        added += 1;
        this.setState(item.id, 'done', stored);
      } catch (error) {
        this.setState(item.id, 'failed');
        this.notifications.error(uploadErrorKey(error), file.name);
      }
    }
    if (added > 0) {
      this.notifications.info('files.upload.added', { count: added });
    }
  }

  async download(file: ProjectFile): Promise<void> {
    try {
      const response = await this.fetchBlob(
        `/projects/${this.requireId()}/files/${file.id}/content`,
      );
      saveBlob(
        this.document,
        response.body ?? new Blob(),
        fileNameFrom(
          response.headers.get('Content-Disposition'),
          file.displayName,
        ),
      );
    } catch {
      this.notifications.error('files.downloadFailed');
    }
  }

  /** The original bytes as an object URL (PDF preview); the caller revokes it. */
  async objectUrl(file: ProjectFile): Promise<string | undefined> {
    try {
      const response = await this.fetchBlob(
        `/projects/${this.requireId()}/files/${file.id}/content`,
      );
      return response.body ? URL.createObjectURL(response.body) : undefined;
    } catch {
      this.notifications.error('files.preview.failed');
      return undefined;
    }
  }

  preview(file: ProjectFile, rows = 50): Promise<FilePreview> {
    return firstValueFrom(
      this.http.get<FilePreview>(
        apiUrl(`/projects/${this.requireId()}/files/${file.id}/preview`),
        { params: { rows } },
      ),
    );
  }

  async remove(file: ProjectFile): Promise<void> {
    await this.actions.run(this.removeAction, file, { key: 'project-files' });
  }

  async assign(
    file: ProjectFile,
    assignment: FileAssignmentRequest,
  ): Promise<void> {
    await this.actions.run(
      this.assignAction,
      { file, assignment },
      { key: 'project-files' },
    );
  }

  /**
   * F5.7a: deactivate (`active: false`, optional note) or activate a file. The calculation turns
   * stale, dashboard, hints and notifications follow (`dataChangesInterceptor`).
   */
  async setActive(
    file: ProjectFile,
    active: boolean,
    note = '',
  ): Promise<void> {
    const trimmed = note.trim();
    const body: SetFileActiveRequest =
      active || trimmed === '' ? { active } : { active, note: trimmed };
    await this.actions.run(
      active ? this.activateAction : this.deactivateAction,
      { file, body },
      { key: 'project-files' },
    );
  }

  /** What a stored or unsaved mapping would read from a file; schema issues instead of a 400 toast. */
  async checkMapping(
    file: ProjectFile,
    source: { mappingId: string } | { spec: unknown },
    limit = 20,
  ): Promise<SpecCheck> {
    try {
      const preview = await firstValueFrom(
        this.http.post<MappingPreview>(
          apiUrl(
            `/projects/${this.requireId()}/files/${file.id}/mapping-preview`,
          ),
          { ...source, limit },
        ),
      );
      return { ok: true, preview };
    } catch (error) {
      const issues = specIssues(error);
      if (issues) return { ok: false, issues };
      this.notifications.error('mappings.checkFailed');
      throw error;
    }
  }

  /**
   * Saves a new mapping (`manual` from the editor, `copied` from an uploaded `.json`) — it is
   * mine, so every project can use it (F11.0); the toast links to its page. Invalid specs come
   * back as issues. Editing an existing mapping happens on the mapping page.
   */
  async saveMapping(
    spec: unknown,
    origin: 'manual' | 'copied',
  ): Promise<
    { ok: true; mapping: Mapping } | { ok: false; issues: readonly SpecIssue[] }
  > {
    try {
      const created = await firstValueFrom(
        this.http.post<Mapping>(apiUrl('/mappings'), { spec, origin }),
      );
      this.notifications.success('mappings.saved', {
        labelKey: 'mappings.openPage',
        onClick: () => void this.router.navigate(['/app/mappings', created.id]),
      });
      return { ok: true, mapping: created };
    } catch (error) {
      const issues = specIssues(error);
      if (issues) return { ok: false, issues };
      this.notifications.error('mappings.saveFailed');
      throw error;
    }
  }

  async downloadMapping(mapping: Mapping): Promise<void> {
    try {
      const response = await this.fetchBlob(`/mappings/${mapping.id}/download`);
      saveBlob(
        this.document,
        response.body ?? new Blob(),
        fileNameFrom(
          response.headers.get('Content-Disposition'),
          `${mapping.name}.json`,
        ),
      );
    } catch {
      this.notifications.error('files.downloadFailed');
    }
  }

  /**
   * F11.2: in the app's language (explanations, example notes); the column headers stay German —
   * they are the format.
   */
  async downloadTemplate(kind: TemplateKind): Promise<void> {
    const language = encodeURIComponent(this.language.locale());
    const path =
      kind === 'xlsx'
        ? `/standard-format/template.xlsx?language=${language}`
        : `/standard-format/template.csv?type=${kind}&language=${language}`;
    try {
      const response = await this.fetchBlob(path as `/${string}`);
      saveBlob(
        this.document,
        response.body ?? new Blob(),
        fileNameFrom(
          response.headers.get('Content-Disposition'),
          'lazy-koins-template',
        ),
      );
    } catch {
      this.notifications.error('files.downloadFailed');
    }
  }

  // --- Mapping suggestions (F5.19) ---

  private readonly takeStandardAction = defineAction<
    { id: string; file: { id: string } },
    TakenStandardMapping
  >({
    run: ({ id, file }) =>
      firstValueFrom(
        this.http.post<TakenStandardMapping>(
          apiUrl(`/standard-mappings/${id}/take`),
          { projectId: this.requireId(), projectFileId: file.id },
        ),
      ),
    messages: { error: 'files.suggestions.takeFailed' },
  });

  /**
   * "Übernehmen": my own mapping is assigned; a standard mapping is copied into my mappings
   * (an identical copy is reused) and assigned; a library entry is copied (F5.16) and assigned.
   * Nothing happens without this click. Resolves false when it failed (already told).
   */
  async takeSuggestion(
    file: { id: string },
    suggestion: MappingSuggestion,
  ): Promise<boolean> {
    try {
      switch (suggestion.source) {
        case 'own':
          await this.actions.run(
            this.assignAction,
            {
              file: file as ProjectFile,
              assignment: { mode: 'mapping', mappingId: suggestion.id },
            },
            { key: `suggestion:${file.id}` },
          );
          return true;
        case 'standard': {
          const taken = await this.actions.run(
            this.takeStandardAction,
            { id: suggestion.id, file },
            {
              key: `suggestion:${file.id}`,
              activity: { label: 'activity.suggestionTake' },
            },
          );
          this.notifications.success('files.suggestions.takenStandard', {
            labelKey: 'mappings.openPage',
            onClick: () =>
              void this.router.navigate(['/app/mappings', taken.mapping.id]),
          });
          return true;
        }
        case 'library':
          return (
            (await this.library.take(suggestion.id, {
              projectId: this.requireId(),
              projectFileId: file.id,
            })) !== undefined
          );
      }
    } catch {
      return false;
    }
  }

  /** What a suggestion would read from the file (kind counts, unknown values, first rows). */
  suggestionPreview(
    file: { id: string },
    suggestion: MappingSuggestion,
  ): Promise<SuggestionPreview> {
    return firstValueFrom(
      this.http.get<SuggestionPreview>(
        apiUrl(
          `/projects/${this.requireId()}/files/${file.id}/suggestion-preview`,
        ),
        { params: { source: suggestion.source, id: suggestion.id, limit: 20 } },
      ),
    );
  }

  /** The spec of a suggestion — the start of "Als Vorlage anpassen" (a near match). */
  async suggestionSpec(
    suggestion: MappingSuggestion,
  ): Promise<Record<string, unknown>> {
    switch (suggestion.source) {
      case 'own': {
        const mine = this.myMappings
          .value()
          ?.find((mapping) => mapping.id === suggestion.id);
        if (mine) return mine.spec;
        return (
          await firstValueFrom(
            this.http.get<Mapping>(apiUrl(`/mappings/${suggestion.id}`)),
          )
        ).spec;
      }
      case 'standard':
        return (
          (
            await firstValueFrom(
              this.http.get<StandardMapping>(
                apiUrl(`/standard-mappings/${suggestion.id}`),
              ),
            )
          ).spec ?? {}
        );
      case 'library':
        return (
          await firstValueFrom(
            this.http.get<LibraryEntryDetail>(
              apiUrl(`/library/${suggestion.id}`),
            ),
          )
        ).spec;
    }
  }

  // --- Hinweise (F5.8) ---

  /** "Als in Ordnung markieren" / "Ignorieren" (with a note) and "Wieder öffnen". */
  async setHintStatus(
    hint: ProjectHint,
    status: HintStatus,
    note = '',
  ): Promise<void> {
    await this.actions.run(
      this.hintAction,
      { key: hint.key, status, note },
      { key: `hint:${hint.key}` },
    );
  }

  /** "Zeilenfehler ansehen": the rows the file's own reader could not read. */
  rowErrors(file: { id: string }, rows = 100): Promise<FileRowErrors> {
    return firstValueFrom(
      this.http.get<FileRowErrors>(
        apiUrl(`/projects/${this.requireId()}/files/${file.id}/row-errors`),
        { params: { rows } },
      ),
    );
  }

  /** Asks the files area to open the mapping assignment of this file (from a hint). */
  requestAssign(fileId: string): void {
    this.pendingAssign.set(fileId);
  }

  private fetchBlob(path: `/${string}`): Promise<HttpResponse<Blob>> {
    return firstValueFrom(
      this.http.get(apiUrl(path), {
        responseType: 'blob',
        observe: 'response',
      }),
    );
  }

  private setState(id: number, state: UploadState, stored?: ProjectFile): void {
    this.uploadQueue.update((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              state,
              ...(stored ? { fileId: stored.id, status: stored.status } : {}),
            }
          : item,
      ),
    );
  }

  private requireId(): string {
    const id = this.projectId();
    if (!id) throw new Error('No project on screen');
    return id;
  }
}

/** The translated reason of a failed upload (F5.1, F5.4). */
export function uploadErrorKey(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'files.upload.failed';
  switch (error.status) {
    case 409:
      return (error.error as { existing?: unknown } | null)?.existing
        ? 'files.upload.duplicate'
        : 'files.upload.closed';
    case 413:
      return 'files.upload.tooBig';
    case 415:
      return 'files.upload.unsupported';
    case 422:
      return 'files.upload.unreadable';
    default:
      return 'files.upload.failed';
  }
}

function specIssues(error: unknown): readonly SpecIssue[] | undefined {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) {
    return undefined;
  }
  const body = error.error as {
    issues?: SpecIssue[];
    message?: unknown;
  } | null;
  if (Array.isArray(body?.issues)) return body.issues;
  const message = body?.message;
  return [
    {
      path: '',
      message: Array.isArray(message)
        ? message.join('; ')
        : String(message ?? ''),
    },
  ];
}
