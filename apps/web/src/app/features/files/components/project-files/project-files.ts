import { DatePipe, DecimalPipe, UpperCasePipe } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  effect,
  inject,
  input,
  type OnDestroy,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideEye,
  lucideLink2,
  lucideScanText,
  lucideSparkles,
  lucideTrash2,
  lucideUpload,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type {
  FilePreview,
  MappingPreview,
  ProjectFile,
  ProjectFileStatus,
} from '../../../../core/api/api.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { AiAssist, AiAssistState } from '../ai-assist';
import { MappingPreviewView } from '../mapping-preview';
import { ProjectMappings } from '../project-mappings';
import { MappingEditorState } from '../project-mappings/mapping-editor.state';
import { ProjectFilesService } from './project-files.service';

type Dialog =
  | { readonly kind: 'preview'; readonly file: ProjectFile }
  | { readonly kind: 'remove'; readonly file: ProjectFile }
  | { readonly kind: 'assign'; readonly file: ProjectFile };

/**
 * The files of a project (F5): upload by drag & drop or picker, the overview grouped by
 * platform, preview, download, removal, manual assignment and the missing-files hints; below it
 * the mappings the project uses. Owns the section's service; a closed project is read-only.
 */
@Component({
  selector: 'lk-project-files',
  imports: [
    DatePipe,
    DecimalPipe,
    UpperCasePipe,
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    EmptyState,
    AiAssist,
    MappingPreviewView,
    ProjectMappings,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [
    ProjectFilesService,
    MappingEditorState,
    AiAssistState,
    provideIcons({
      lucideDownload,
      lucideEye,
      lucideLink2,
      lucideScanText,
      lucideSparkles,
      lucideTrash2,
      lucideUpload,
    }),
  ],
  templateUrl: './project-files.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectFiles implements OnDestroy {
  protected readonly service = inject(ProjectFilesService);
  private readonly editor = inject(MappingEditorState);
  protected readonly ai = inject(AiAssistState);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly document = inject(DOCUMENT);
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment);

  readonly projectId = input.required<string>();
  /** F4.5: no uploads, removals or assignments while closed. */
  readonly closed = input(false);

  protected readonly dragging = signal(false);
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly tablePreview = signal<FilePreview | null>(null);
  protected readonly pdfUrl = signal<string | null>(null);
  protected readonly safePdfUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.pdfUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });
  protected readonly selectedMappingId = signal('');
  protected readonly assignPreview = signal<MappingPreview | null>(null);

  protected readonly skeletonRows = [1, 2, 3];

  /** `#file-<id>` (a link from the mapping page, F11.0): that file's row is marked. */
  protected readonly highlighted = computed(() => {
    const fragment = this.fragment();
    return fragment?.startsWith('file-') ? fragment.slice(5) : null;
  });
  private scrolledTo: string | null = null;

  constructor() {
    effect(() => this.service.projectId.set(this.projectId()));
    // The rows arrive after the route did its own (anchor-less) scrolling: scroll once they exist.
    afterRenderEffect(() => {
      const id = this.highlighted();
      if (!id || id === this.scrolledTo || !this.service.overview.hasValue()) {
        return;
      }
      const row = this.document.getElementById(`file-${id}`);
      if (!row) return;
      this.scrolledTo = id;
      row.scrollIntoView({ block: 'center' });
    });
  }

  ngOnDestroy(): void {
    this.releasePdf();
  }

  protected statusVariant(
    status: ProjectFileStatus,
  ): 'default' | 'secondary' | 'outline' | 'destructive' {
    switch (status) {
      case 'standard':
      case 'mapped':
        return 'secondary';
      case 'needs_mapping':
        return 'destructive';
      default:
        return 'outline';
    }
  }

  protected dragOver(event: DragEvent): void {
    if (this.closed()) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected dragLeave(): void {
    this.dragging.set(false);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.closed()) return;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) void this.service.upload(files);
  }

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = [...(target.files ?? [])];
    target.value = '';
    if (files.length > 0) void this.service.upload(files);
  }

  protected async openPreview(file: ProjectFile): Promise<void> {
    this.releasePdf();
    this.tablePreview.set(null);
    this.dialog.set({ kind: 'preview', file });
    if (file.kind === 'pdf') {
      this.pdfUrl.set((await this.service.objectUrl(file)) ?? null);
    } else {
      try {
        this.tablePreview.set(await this.service.preview(file));
      } catch {
        this.dialog.set(null);
      }
    }
  }

  protected openAssign(file: ProjectFile): void {
    this.assignPreview.set(null);
    this.selectedMappingId.set(file.mappingId ?? '');
    this.dialog.set({ kind: 'assign', file });
  }

  protected async previewAssignment(file: ProjectFile): Promise<void> {
    const mappingId = this.selectedMappingId();
    if (!mappingId) return;
    const check = await this.service.checkMapping(file, { mappingId });
    this.assignPreview.set(check.ok ? check.preview : null);
  }

  protected assign(
    file: ProjectFile,
    mode: 'mapping' | 'evidenceOnly' | 'automatic',
  ): void {
    const mappingId = this.selectedMappingId();
    this.dialog.set(null);
    const assignment = mode === 'mapping' ? { mode, mappingId } : { mode };
    void this.service.assign(file, assignment).catch(() => undefined);
  }

  protected async newMappingFor(file: ProjectFile): Promise<void> {
    this.dialog.set(null);
    await this.editor.openNew(file);
  }

  /** F5.13: "Mit AI erstellen" (a table) or "Mit AI auslesen" (a PDF statement). */
  protected withAi(file: ProjectFile): void {
    this.dialog.set(null);
    void this.ai.start(file, file.kind === 'pdf' ? 'statement' : 'mapping');
  }

  protected confirmRemove(file: ProjectFile): void {
    this.dialog.set(null);
    void this.service.remove(file).catch(() => undefined);
  }

  protected dialogState(kind: Dialog['kind']): 'open' | 'closed' {
    return this.dialog()?.kind === kind ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') {
      this.dialog.set(null);
      this.releasePdf();
    }
  }

  protected openPdfInTab(): void {
    const url = this.pdfUrl();
    if (url) window.open(url, '_blank', 'noopener');
  }

  private releasePdf(): void {
    const url = this.pdfUrl();
    if (url) URL.revokeObjectURL(url);
    this.pdfUrl.set(null);
  }
}
