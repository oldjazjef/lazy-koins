import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../../../core/api/api-url';
import {
  BOOKING_KINDS,
  type AiRequestPreview,
  type AiSettings,
  type BookingKind,
  type MappingCandidate,
  type Project,
  type ProjectFile,
  type ProjectFiles,
  type SampleInspection,
  type SamplePreview,
  type SpecIssue,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { aiErrorKey } from '../../../../shared/ai/ai-error-key';
import { readablePayload } from '../../../files/components/ai-assist/ai-assist.state';
import { parseSpecText } from '../../../files/components/mapping-editor';
import {
  MAX_FILE_BYTES,
  uploadErrorKey,
} from '../../../files/components/project-files/project-files.service';

/** The sample file of an editing session — held in the browser only, never stored by the API. */
export interface SampleSource {
  readonly name: string;
  readonly blob: Blob;
  readonly size: number;
  /** Picked from a project (its bytes were downloaded); `null` = from this computer. */
  readonly from: { readonly projectName: string } | null;
}

/**
 * - `loading`: settings + the exact payload are fetched;
 * - `notReady`: the plugin is off / not configured;
 * - `consent`: what will be sent (F5.14), consent the first time;
 * - `working`: the provider is busy.
 */
export type SampleAiStep =
  'closed' | 'loading' | 'notReady' | 'consent' | 'working';

/** Records shown in the live preview; the counts always cover the whole file. */
const PREVIEW_LIMIT = 50;

/**
 * The mapping editor with a **sample file** ("Beispieldatei", F5.11/F11.0): the JSON, a file from
 * this computer or one of my projects, its raw table, "Vorlage aus Datei", a **live preview** of
 * the spec on the whole file (debounced) with kind counts, unknown values, row errors and whether
 * an upload would recognise the file, and "Mit AI erstellen" from the sample (F5.13/F5.14). The
 * sample is sent with each request and never stored — unless the user adds it to a project.
 *
 * Provided by the page that hosts the editor (new-mapping dialog, mapping page); the host saves.
 */
@Injectable()
export class MappingWorkbenchService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  /** Debounce of the live preview while typing (ms). */
  previewDelay = 600;

  // --- Editor ---

  readonly text = signal('');
  /** Issues of a refused save (the host sets them); otherwise the live preview's. */
  readonly saveIssues = signal<readonly SpecIssue[]>([]);
  readonly invalidJson = computed(
    () => parseSpecText(this.text()) === undefined,
  );
  readonly issues = computed<readonly SpecIssue[]>(() =>
    this.saveIssues().length > 0
      ? this.saveIssues()
      : this.invalidJson()
        ? []
        : (this.live()?.issues ?? []),
  );
  /** The mapping being edited (not its own competitor in the fingerprint check). */
  private mappingId: string | undefined;
  /**
   * The text as a NEW mapping's session started — a sample loaded while it is unchanged replaces
   * it with the skeleton. 
ull when editing a stored mapping (never replaced without asking).
   */
  private pristine: string | null = null;

  // --- Sample ---

  readonly sample = signal<SampleSource | null>(null);
  readonly inspection = signal<SampleInspection | null>(null);
  readonly loadingSample = signal(false);
  readonly live = signal<SamplePreview | null>(null);
  readonly previewing = signal(false);
  readonly previewFailed = signal(false);
  /** What the right column shows: the live preview or the file as it is. */
  readonly tab = signal<'preview' | 'raw'>('preview');

  /** The header row (1-based) and the rows of the raw table, as the API sampled them. */
  readonly rawRows = computed(() => this.inspection()?.sample.rows ?? []);
  readonly headerRow = computed(
    () => this.inspection()?.sample.headerRowGuess ?? 1,
  );
  readonly rawWidth = computed(() =>
    this.rawRows().reduce((width, row) => Math.max(width, row.length), 0),
  );

  /** Kinds in the standard format's order, only those that occur. */
  readonly kindCounts = computed(() => {
    const counts = this.live()?.kindCounts ?? {};
    return BOOKING_KINDS.filter((kind) => (counts[kind] ?? 0) > 0).map(
      (kind: BookingKind) => ({ kind, count: counts[kind] ?? 0 }),
    );
  });

  // --- "Datei aus einem Projekt wählen" ---

  readonly picking = signal(false);
  readonly pickProjectId = signal('');
  readonly pickFileId = signal('');
  /** My projects — for the picker and for "auch zu Projekt hinzufügen". */
  private readonly wantProjects = computed(
    () => this.picking() || this.sample() !== null,
  );
  readonly projects = httpResource<Project[]>(() =>
    this.wantProjects() ? apiUrl('/projects') : undefined,
  );
  /** Projects a sample can be added to (F4.5: a closed project accepts no file). */
  readonly openProjects = computed(() =>
    (this.projects.value() ?? []).filter(
      (project) => project.status !== 'closed',
    ),
  );
  private readonly projectFiles = httpResource<ProjectFiles>(() => {
    const id = this.pickProjectId();
    return this.picking() && id ? apiUrl(`/projects/${id}/files`) : undefined;
  });
  /** Table files of the chosen project (a PDF cannot be a mapping's sample). */
  readonly pickableFiles = computed<ProjectFile[]>(() =>
    (this.projectFiles.hasValue() ? this.projectFiles.value().groups : [])
      .flatMap((group) => group.files)
      .filter((file) => file.kind !== 'pdf'),
  );
  readonly loadingFiles = computed(() => this.projectFiles.isLoading());

  // --- "Mit AI erstellen" from the sample ---

  readonly aiStep = signal<SampleAiStep>('closed');
  readonly aiNotReadyReason = signal<'disabled' | 'notConfigured'>('disabled');
  readonly aiRequest = signal<AiRequestPreview | null>(null);
  readonly aiPayloadText = computed(() => {
    const request = this.aiRequest();
    return request ? readablePayload(request.payload) : '';
  });
  readonly consentChecked = signal(false);
  readonly canSendAi = computed(
    () => this.aiRequest()?.consentGiven === true || this.consentChecked(),
  );
  /** The last AI proposal (model, rounds, usage, problems) — its spec is in the editor. */
  readonly aiCandidate = signal<MappingCandidate | null>(null);

  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Answers that arrive after a newer request (or a reset) are dropped. */
  private loadSeq = 0;
  private previewSeq = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelTimer());
  }

  /** A new editing session: the text, no sample, nothing pending. */
  start(text: string, mappingId?: string): void {
    this.cancelTimer();
    this.loadSeq += 1;
    this.previewSeq += 1;
    this.mappingId = mappingId;
    this.pristine = mappingId === undefined ? text : null;
    this.text.set(text);
    this.saveIssues.set([]);
    this.sample.set(null);
    this.inspection.set(null);
    this.live.set(null);
    this.previewing.set(false);
    this.previewFailed.set(false);
    this.loadingSample.set(false);
    this.picking.set(false);
    this.aiStep.set('closed');
    this.aiCandidate.set(null);
    this.tab.set('preview');
  }

  /** The user typed: keep the text, preview it once typing pauses. */
  edit(text: string): void {
    this.text.set(text);
    this.saveIssues.set([]);
    this.schedulePreview();
  }

  /** A file from this computer (drop zone or picker). Checked here first, then by the API. */
  async useFile(file: File): Promise<void> {
    if (/\.pdf$/i.test(file.name)) {
      this.notifications.error('mappings.sample.notTable', file.name);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      this.notifications.error('files.upload.tooBig', file.name);
      return;
    }
    if (file.size === 0) {
      this.notifications.error('mappings.sample.empty', file.name);
      return;
    }
    await this.load({
      name: file.name,
      blob: file,
      size: file.size,
      from: null,
    });
  }

  openPicker(): void {
    this.picking.set(true);
  }

  closePicker(): void {
    this.picking.set(false);
  }

  pickProject(projectId: string): void {
    this.pickProjectId.set(projectId);
    this.pickFileId.set('');
  }

  /** "Datei aus einem Projekt wählen": the stored bytes are downloaded and used as the sample. */
  async usePickedFile(): Promise<void> {
    const projectId = this.pickProjectId();
    const file = this.pickableFiles().find((f) => f.id === this.pickFileId());
    if (!projectId || !file) return;
    const project = this.projects.value()?.find((p) => p.id === projectId);
    const loaded = await this.useProjectFile(
      projectId,
      file,
      project?.name ?? '',
    );
    if (loaded) this.picking.set(false);
  }

  /** A file of one of my projects as the sample (its bytes, downloaded — nothing is copied). */
  async useProjectFile(
    projectId: string,
    file: { readonly id: string; readonly displayName: string },
    projectName: string,
  ): Promise<boolean> {
    this.loadingSample.set(true);
    let blob: Blob;
    try {
      blob = await firstValueFrom(
        this.http.get(
          apiUrl(`/projects/${projectId}/files/${file.id}/content`),
          { responseType: 'blob' },
        ),
      );
    } catch {
      this.loadingSample.set(false);
      this.notifications.error('mappings.sample.loadFailed', file.displayName);
      return false;
    }
    return this.load({
      name: file.displayName,
      blob,
      size: blob.size,
      from: { projectName },
    });
  }
  clearSample(): void {
    this.cancelTimer();
    this.loadSeq += 1;
    this.previewSeq += 1;
    this.sample.set(null);
    this.inspection.set(null);
    this.live.set(null);
    this.previewing.set(false);
  }

  /** "Vorlage aus Datei": the skeleton from the sample's header replaces the editor's text. */
  applyTemplate(): void {
    const inspection = this.inspection();
    if (!inspection) return;
    this.text.set(JSON.stringify(inspection.skeleton, null, 2));
    this.saveIssues.set([]);
    this.tab.set('preview');
    void this.refreshPreview();
  }

  /** Previews the current text on the sample now (also the debounced call). */
  async refreshPreview(): Promise<void> {
    this.cancelTimer();
    const sample = this.sample();
    if (!sample || this.invalidJson()) return;
    const seq = ++this.previewSeq;
    this.previewing.set(true);
    const form = this.form(sample);
    form.append('spec', this.text());
    form.append('limit', String(PREVIEW_LIMIT));
    if (this.mappingId) form.append('mappingId', this.mappingId);
    try {
      const preview = await firstValueFrom(
        this.http.post<SamplePreview>(apiUrl('/mapping-samples/preview'), form),
      );
      if (seq !== this.previewSeq) return;
      this.live.set(preview);
      this.previewFailed.set(false);
    } catch {
      if (seq !== this.previewSeq) return;
      this.previewFailed.set(true);
    } finally {
      if (seq === this.previewSeq) this.previewing.set(false);
    }
  }

  // --- AI ---

  /** Settings, then exactly the payload — nothing is sent to the provider yet (F5.14). */
  async startAi(): Promise<void> {
    const sample = this.sample();
    if (!sample) return;
    this.aiRequest.set(null);
    this.consentChecked.set(false);
    this.aiStep.set('loading');
    try {
      const settings = await firstValueFrom(
        this.http.get<AiSettings>(apiUrl('/ai/settings')),
      );
      if (!settings.enabled || !settings.ready) {
        this.aiNotReadyReason.set(
          settings.enabled ? 'notConfigured' : 'disabled',
        );
        this.aiStep.set('notReady');
        return;
      }
      const request = await firstValueFrom(
        this.http.post<AiRequestPreview>(
          apiUrl('/ai/mapping-sample/payload'),
          this.form(sample),
        ),
      );
      this.aiRequest.set(request);
      this.aiStep.set('consent');
    } catch (error) {
      this.notifications.error(aiErrorKey(error));
      this.aiStep.set('closed');
    }
  }

  /** Sends the shown payload; the proposal lands in the editor for review — nothing is saved. */
  async sendAi(): Promise<void> {
    const sample = this.sample();
    if (!sample || !this.canSendAi()) return;
    this.aiStep.set('working');
    const form = this.form(sample);
    form.append('consent', String(this.consentChecked()));
    try {
      const candidate = await firstValueFrom(
        this.http.post<MappingCandidate>(apiUrl('/ai/mapping-sample'), form),
      );
      this.aiCandidate.set(candidate);
      this.text.set(JSON.stringify(candidate.spec, null, 2));
      this.saveIssues.set([]);
      this.aiStep.set('closed');
      this.tab.set('preview');
      void this.refreshPreview();
    } catch (error) {
      this.notifications.error(aiErrorKey(error));
      this.aiStep.set('consent');
    }
  }

  closeAi(): void {
    this.aiStep.set('closed');
  }

  /**
   * "Datei auch zu Projekt hinzufügen": uploads the sample to the project (the usual upload,
   * F5.1) and makes sure it is read with the saved mapping. A duplicate is reported, not changed.
   */
  async addToProject(
    projectId: string,
    mapping: { readonly id: string },
  ): Promise<boolean> {
    const sample = this.sample();
    if (!sample) return false;
    try {
      let file = await firstValueFrom(
        this.http.post<ProjectFile>(
          apiUrl(`/projects/${projectId}/files`),
          sample.blob,
          {
            params: { name: sample.name },
            headers: { 'Content-Type': 'application/octet-stream' },
          },
        ),
      );
      if (file.status !== 'standard' && file.mappingId !== mapping.id) {
        file = await firstValueFrom(
          this.http.patch<ProjectFile>(
            apiUrl(`/projects/${projectId}/files/${file.id}`),
            { mode: 'mapping', mappingId: mapping.id },
          ),
        );
      }
      const added = file;
      this.notifications.success('mappings.sample.addedToProject', {
        labelKey: 'mappings.sample.openFile',
        onClick: () =>
          void this.router.navigate(['/app/projects', projectId], {
            fragment: `file-${added.id}`,
          }),
      });
      return true;
    } catch (error) {
      this.notifications.error(uploadErrorKey(error), sample.name);
      return false;
    }
  }

  private async load(sample: SampleSource): Promise<boolean> {
    this.cancelTimer();
    const seq = ++this.loadSeq;
    this.loadingSample.set(true);
    try {
      const inspection = await firstValueFrom(
        this.http.post<SampleInspection>(
          apiUrl('/mapping-samples/inspect'),
          this.form(sample),
        ),
      );
      if (seq !== this.loadSeq) return false;
      this.previewSeq += 1;
      this.sample.set(sample);
      this.inspection.set(inspection);
      this.live.set(null);
      this.aiCandidate.set(null);
      if (this.pristine !== null && this.text() === this.pristine) {
        // Nothing written yet: start from the file's own columns.
        this.text.set(JSON.stringify(inspection.skeleton, null, 2));
      }
      void this.refreshPreview();
      return true;
    } catch (error) {
      if (seq === this.loadSeq) {
        this.notifications.error(sampleErrorKey(error), sample.name);
      }
      return false;
    } finally {
      if (seq === this.loadSeq) this.loadingSample.set(false);
    }
  }

  private form(sample: SampleSource): FormData {
    const form = new FormData();
    form.append('file', sample.blob, sample.name);
    form.append('name', sample.name);
    return form;
  }

  private schedulePreview(): void {
    this.cancelTimer();
    if (!this.sample()) return;
    this.timer = setTimeout(
      () => void this.refreshPreview(),
      this.previewDelay,
    );
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** Why a sample file was refused (F5.1 limits, tables only). */
export function sampleErrorKey(error: unknown): string {
  if (!(error instanceof HttpErrorResponse))
    return 'mappings.sample.loadFailed';
  switch (error.status) {
    case 413:
      return 'files.upload.tooBig';
    case 415:
    case 422:
      return 'mappings.sample.notTable';
    default:
      return 'mappings.sample.loadFailed';
  }
}
