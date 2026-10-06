import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideSearch, lucideUpload } from '@ng-icons/lucide';
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
import { skeleton } from '../../../files/components/mapping-editor';
import {
  MappingWorkbench,
  MappingWorkbenchService,
} from '../../components/mapping-workbench';
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
    DatePipe,
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    PageHeader,
    EmptyState,
    MappingWorkbench,
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
    provideIcons({ lucidePlus, lucideSearch, lucideUpload }),
  ],
  templateUrl: './mappings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingsPage {
  protected readonly service = inject(MappingsPageService);
  private readonly router = inject(Router);
  protected readonly sorts = MAPPING_SORTS;
  protected readonly skeletonRows = [1, 2, 3];

  /** The "Neues Mapping" dialog: the editor with a sample file (state in the workbench). */
  protected readonly workbench = inject(MappingWorkbenchService);
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  /** "Datei auch zu Projekt … hinzufügen" after saving; '' = no. */
  protected readonly addToProjectId = signal('');

  constructor() {
    this.service.refresh();
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
    const file = target.files?.[0];
    target.value = '';
    if (file) void this.service.upload(file);
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
