import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideLibraryBig,
  lucidePlus,
  lucideSearch,
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
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';
import { skeleton } from '../../../files/components/mapping-editor';
import {
  MappingWorkbench,
  MappingWorkbenchService,
} from '../../components/mapping-workbench';
import type { MappingSummary } from '../../../../core/api/api.types';
import { LibraryAvailability } from '../../../../core/library/library-availability.service';
import {
  BulkPublishDialog,
  BulkPublishService,
} from '../../../library/components/bulk-publish-dialog';
import { MappingImportResults } from '../../components/mapping-import-results';
import { MappingImportService } from '../../mapping-import.service';
import {
  MAPPING_SORTS,
  type MappingSort,
  MappingsPageService,
} from './mappings-page.service';

/**
 * F11.0: the mappings page in the main menu — every mapping of mine with platform, origin,
 * version, last change and how many files use it; search, sort, upload a `.json`, write a new
 * one. A row opens the mapping's page (`/app/mappings/:id`).
 */
@Component({
  selector: 'lk-mappings-page',
  imports: [
    LkDatePipe,
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    PageHeader,
    EmptyState,
    MappingWorkbench,
    MappingImportResults,
    BulkPublishDialog,
    Paginator,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [
    MappingWorkbenchService,
    BulkPublishService,
    provideIcons({ lucideLibraryBig, lucidePlus, lucideSearch, lucideUpload }),
  ],
  templateUrl: './mappings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingsPage {
  protected readonly service = inject(MappingsPageService);
  private readonly router = inject(Router);
  protected readonly sorts = MAPPING_SORTS;
  protected readonly skeletonRows = [1, 2, 3];
  protected readonly pager = paginate(this.service.visible, {
    storageKey: 'mappings',
    resetOn: () => [this.service.search(), this.service.sort()],
  });

  /** The "Neues Mapping" dialog: the editor with a sample file (state in the workbench). */
  protected readonly workbench = inject(MappingWorkbenchService);
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  /** "Datei auch zu Projekt … hinzufügen" after saving; '' = no. */
  protected readonly addToProjectId = signal('');

  /** F11.0u: several `.json` at once (picker or drop zone). */
  protected readonly imports = inject(MappingImportService);
  protected readonly dragging = signal(false);

  /** F5.20: row selection for "In Bibliothek veröffentlichen" — only with a writable library (web). */
  private readonly library = inject(LibraryAvailability);
  protected readonly bulk = inject(BulkPublishService);
  protected readonly canPublish = computed(
    () => this.library.status()?.mode === 'web' && !this.library.readOnly(),
  );
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedCount = computed(() => this.selected().size);
  /** Every row on this page is ticked. */
  protected readonly pageSelected = computed(() => {
    const rows = this.pager.visible();
    return rows.length > 0 && rows.every((row) => this.selected().has(row.id));
  });
  protected readonly pagePartly = computed(
    () =>
      !this.pageSelected() &&
      this.pager.visible().some((row) => this.selected().has(row.id)),
  );

  constructor() {
    this.service.follow();
    // A new search or sort shows other rows: the selection starts over.
    effect(() => {
      this.service.search();
      this.service.sort();
      untracked(() => this.selected.set(new Set()));
    });
    this.bulk.onPublished = () => this.selected.set(new Set());
  }

  protected isSelected(mapping: MappingSummary): boolean {
    return this.selected().has(mapping.id);
  }

  protected toggleRow(mapping: MappingSummary): void {
    const next = new Set(this.selected());
    if (next.has(mapping.id)) next.delete(mapping.id);
    else next.add(mapping.id);
    this.selected.set(next);
  }

  protected togglePage(): void {
    const next = new Set(this.selected());
    const rows = this.pager.visible();
    if (this.pageSelected()) rows.forEach((row) => next.delete(row.id));
    else rows.forEach((row) => next.add(row.id));
    this.selected.set(next);
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected publishSelected(): void {
    const chosen = this.selected();
    const mappings = (
      this.service.mappings.hasValue() ? this.service.mappings.value() : []
    ).filter((mapping) => chosen.has(mapping.id));
    if (mappings.length > 0) void this.bulk.start(mappings);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected dragLeave(): void {
    this.dragging.set(false);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) =>
      file.name.toLowerCase().endsWith('.json'),
    );
    if (files.length > 0) void this.imports.importFiles(files);
  }

  protected setSort(value: string): void {
    if ((MAPPING_SORTS as readonly string[]).includes(value)) {
      this.service.sort.set(value as MappingSort);
    }
  }

  protected open(id: string): void {
    void this.router.navigate(['/app/mappings', id]);
  }

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = [...(target.files ?? [])];
    target.value = '';
    if (files.length > 0) void this.imports.importFiles(files);
  }

  protected startNew(): void {
    this.workbench.start(JSON.stringify(skeleton('', []), null, 2));
    this.addToProjectId.set('');
    this.creating.set(true);
  }

  protected async saveNew(): Promise<void> {
    if (this.workbench.invalidJson()) return;
    this.busy.set(true);
    const projectId = this.workbench.sample() ? this.addToProjectId() : '';
    try {
      const outcome = await this.service.create(
        this.workbench.text(),
        projectId
          ? (mapping) => this.workbench.addToProject(projectId, mapping)
          : undefined,
        this.workbench.aiCandidate() ? 'ai' : 'manual',
      );
      if (outcome === 'invalidJson') return;
      if (outcome.ok) this.creating.set(false);
      else this.workbench.saveIssues.set(outcome.issues);
    } catch {
      // The service has shown the failure.
    } finally {
      this.busy.set(false);
    }
  }
  protected dialogState(): 'open' | 'closed' {
    return this.creating() ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.creating.set(false);
  }
}
