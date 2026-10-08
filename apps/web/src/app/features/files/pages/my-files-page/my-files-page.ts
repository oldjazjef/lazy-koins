import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideEye,
  lucideFolderPlus,
  lucideLink2,
  lucideTrash2,
  lucideUpload,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type {
  FilePreview,
  ProjectFileStatus,
  UserFile,
} from '../../../../core/api/api.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { HelpLink } from '../../../help/components/help-link';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { NumberPipe } from '../../../../shared/format/number-format';
import { isReadEmpty } from '../../components/project-files/project-files';
import { MyFilesPageService } from './my-files-page.service';

type FileAction = 'preview' | 'download' | 'assign' | 'add' | 'delete';

type Dialog =
  | { readonly kind: 'preview'; readonly file: UserFile }
  | { readonly kind: 'assign'; readonly file: UserFile }
  | { readonly kind: 'add'; readonly file: UserFile }
  | { readonly kind: 'delete'; readonly file: UserFile };

/** The row menu of one file. */
export function myFileActions(file: UserFile): RowAction<FileAction>[] {
  return [
    { id: 'preview', labelKey: 'files.actions.preview', icon: lucideEye },
    {
      id: 'download',
      labelKey: 'files.actions.download',
      icon: lucideDownload,
    },
    {
      id: 'assign',
      labelKey: 'files.actions.assign',
      icon: lucideLink2,
      hidden: file.kind === 'pdf',
    },
    {
      id: 'add',
      labelKey: 'myFiles.actions.add',
      icon: lucideFolderPlus,
    },
    {
      id: 'delete',
      labelKey: 'myFiles.actions.delete',
      icon: lucideTrash2,
      danger: true,
    },
  ];
}

/**
 * "Dateien" in the main navigation (F5.21–F5.23): every file of mine, grouped by platform, with
 * how it is read (for every project), its period over the years and the projects that use it.
 */
@Component({
  selector: 'lk-my-files-page',
  imports: [
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    LkDatePipe,
    NumberPipe,
    PageHeader,
    HelpLink,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [provideIcons({ lucideUpload })],
  templateUrl: './my-files-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyFilesPage {
  protected readonly service = inject(MyFilesPageService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly skeletonRows = [1, 2, 3];
  protected readonly dragging = signal(false);

  protected readonly pager = paginate(this.service.visible, {
    storageKey: 'my-files',
    resetOn: () => [this.service.search(), this.service.platform()],
  });

  protected readonly actions = computed(
    () =>
      new Map(
        this.service.visible().map((f) => [f.id, myFileActions(f)] as const),
      ),
  );

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly tablePreview = signal<FilePreview | null>(null);
  protected readonly pdfUrl = signal<string | null>(null);
  protected readonly safePdfUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.pdfUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });
  /** Assign dialog: `mapping:<id>`, `automatic` or `evidenceOnly`. */
  protected readonly assignChoice = signal('automatic');
  protected readonly addTarget = signal('');
  /** Closed projects that blocked the last change or delete (409). */
  protected readonly blockedBy = signal<string[]>([]);

  constructor() {
    this.service.follow();
    inject(DestroyRef).onDestroy(() => this.releasePdf());
  }

  /** The first file of each platform on the page starts a group row. */
  protected startsGroup(index: number): boolean {
    const rows = this.pager.visible();
    return index === 0 || rows[index - 1]?.platform !== rows[index]?.platform;
  }

  protected isReadEmpty(file: UserFile): boolean {
    return isReadEmpty(file);
  }

  protected statusVariant(
    status: ProjectFileStatus,
  ): 'default' | 'secondary' | 'outline' | 'destructive' {
    return status === 'standard' || status === 'mapped'
      ? 'secondary'
      : status === 'needs_mapping'
        ? 'destructive'
        : 'outline';
  }

  protected picked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) void this.service.upload(files);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) void this.service.upload(files);
  }

  protected async act(action: string, file: UserFile): Promise<void> {
    this.blockedBy.set([]);
    switch (action as FileAction) {
      case 'download':
        void this.service.download(file);
        return;
      case 'preview':
        this.dialog.set({ kind: 'preview', file });
        this.tablePreview.set(null);
        this.releasePdf();
        if (file.kind === 'pdf') {
          this.pdfUrl.set((await this.service.objectUrl(file)) ?? null);
        } else {
          try {
            this.tablePreview.set(await this.service.preview(file));
          } catch {
            this.dialog.set(null);
          }
        }
        return;
      case 'assign':
        this.assignChoice.set(
          file.mappingId ? `mapping:${file.mappingId}` : 'automatic',
        );
        this.dialog.set({ kind: 'assign', file });
        return;
      case 'add':
        this.addTarget.set(this.firstFreeProject(file) ?? '');
        this.dialog.set({ kind: 'add', file });
        return;
      case 'delete':
        this.dialog.set({ kind: 'delete', file });
        return;
    }
  }

  /** Open projects that do not use the file yet. */
  protected projectsFor(file: UserFile) {
    const used = new Set(file.usedIn.map((u) => u.projectId));
    return this.service.openProjects().filter((p) => !used.has(p.id));
  }

  private firstFreeProject(file: UserFile): string | undefined {
    return this.projectsFor(file)[0]?.id;
  }

  protected async confirmAssign(file: UserFile): Promise<void> {
    const choice = this.assignChoice();
    const blocked = await this.service.assign(
      file,
      choice.startsWith('mapping:')
        ? { mode: 'mapping', mappingId: choice.slice('mapping:'.length) }
        : choice === 'evidenceOnly'
          ? { mode: 'evidenceOnly' }
          : { mode: 'automatic' },
    );
    if (blocked.length > 0) this.blockedBy.set(blocked);
    else this.dialog.set(null);
  }

  protected async confirmAdd(file: UserFile): Promise<void> {
    const projectId = this.addTarget();
    if (!projectId) return;
    this.dialog.set(null);
    await this.service.addToProject(file, projectId).catch(() => undefined);
  }

  protected async confirmDelete(file: UserFile): Promise<void> {
    const blocked = await this.service.remove(file);
    if (blocked.length > 0) this.blockedBy.set(blocked);
    else this.dialog.set(null);
  }

  protected dialogState(kind: Dialog['kind']): 'open' | 'closed' {
    return this.dialog()?.kind === kind ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') {
      this.dialog.set(null);
      this.blockedBy.set([]);
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
