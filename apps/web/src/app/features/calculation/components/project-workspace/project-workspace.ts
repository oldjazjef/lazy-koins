import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { QuantityPipe } from '../../../../shared/format/number-format';
import { ProjectFiles } from '../../../files/components/project-files';
import { ProjectWallets } from '../../../wallets/components/project-wallets';
import { ProjectChecks } from '../project-checks/project-checks';
import { ProjectCorrections } from '../project-corrections/project-corrections';
import { ProjectExports } from '../project-exports/project-exports';
import { ProjectRates } from '../project-rates/project-rates';
import { ProjectResult } from '../project-result/project-result';
import {
  ProjectWorkspaceService,
  WORKSPACE_TABS,
  type WorkspaceTab,
} from './project-workspace.service';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';

/**
 * The project detail's working area as tabs: Dateien (+ Mappings), Kurse, Ergebnis, Prüfungen,
 * Korrekturen, Exporte. Owns the workspace service the tabs share, and the drill-down dialog
 * (F7.5: amount → records → file and row) every tab opens.
 */
@Component({
  selector: 'lk-project-workspace',
  imports: [
    DatePipe,
    TranslatePipe,
    Paginator,
    Truncate,
    QuantityPipe,
    ProjectFiles,
    ProjectWallets,
    ProjectRates,
    ProjectResult,
    ProjectChecks,
    ProjectCorrections,
    ProjectExports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [ProjectWorkspaceService],
  templateUrl: './project-workspace.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectWorkspace {
  protected readonly service = inject(ProjectWorkspaceService);
  protected readonly tabs = WORKSPACE_TABS;

  readonly projectId = input.required<string>();
  readonly closed = input(false);
  readonly taxYear = input.required<number>();

  /** F7.5 drill-down: the records behind a figure, 10 per page. */
  protected readonly recordsPager = paginate(
    computed(() => this.service.records()?.records ?? []),
    {
      storageKey: 'records',
      resetOn: () => this.service.recordsOf()?.figureId,
    },
  );

  constructor() {
    effect(() => this.service.projectId.set(this.projectId()));
  }

  protected select(tab: WorkspaceTab): void {
    this.service.tab.set(tab);
  }

  protected recordsState(): 'open' | 'closed' {
    return this.service.recordsOf() ? 'open' : 'closed';
  }

  protected recordsChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.service.closeRecords();
  }

  protected rawEntries(raw: Record<string, string> | null): [string, string][] {
    return raw ? Object.entries(raw) : [];
  }
}
