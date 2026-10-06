import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RecordsDialog } from '../../../../shared/components/records-dialog';
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

/**
 * The project detail's working area as tabs: Dateien (+ Mappings), Kurse, Ergebnis, Prüfungen,
 * Korrekturen, Exporte. Owns the workspace service the tabs share, and the drill-down dialog
 * (F7.5: amount → records → file and row) every tab opens.
 */
@Component({
  selector: 'lk-project-workspace',
  imports: [
    TranslatePipe,
    RecordsDialog,
    ProjectFiles,
    ProjectWallets,
    ProjectRates,
    ProjectResult,
    ProjectChecks,
    ProjectCorrections,
    ProjectExports,
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

  constructor() {
    effect(() => this.service.projectId.set(this.projectId()));
  }

  protected select(tab: WorkspaceTab): void {
    this.service.tab.set(tab);
  }
}
