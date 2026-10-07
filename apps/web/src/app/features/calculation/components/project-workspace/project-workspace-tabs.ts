import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ProjectFilesService } from '../../../files/components/project-files/project-files.service';
import {
  ProjectWorkspaceService,
  WORKSPACE_TABS,
  type WorkspaceTab,
} from './project-workspace.service';

/**
 * The workspace's tab bar. It lives in the sticky page header (user rule, 08.10.2026: "Tab bar
 * unter den Seitenkopf"), so it shares the workspace services the detail page provides.
 */
@Component({
  selector: 'lk-project-workspace-tabs',
  imports: [TranslatePipe],
  template: `
    <nav
      class="lk-page-tabs flex flex-wrap gap-1"
      role="tablist"
      [attr.aria-label]="'workspace.label' | translate"
    >
      @for (tab of tabs; track tab) {
        <button
          type="button"
          role="tab"
          class="lk-tab"
          [class.lk-tab-active]="service.tab() === tab"
          [attr.aria-selected]="service.tab() === tab"
          (click)="select(tab)"
        >
          {{ 'workspace.tabs.' + tab | translate }}
          @if (tab === 'hints' && files.openHints() > 0) {
            <span
              class="bg-primary text-primary-foreground ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs tabular-nums"
              [attr.aria-label]="
                'hints.badge' | translate: { count: files.openHints() }
              "
              >{{ files.openHints() }}</span
            >
          }
        </button>
      }
    </nav>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectWorkspaceTabs {
  protected readonly service = inject(ProjectWorkspaceService);
  protected readonly files = inject(ProjectFilesService);
  protected readonly tabs = WORKSPACE_TABS;

  protected select(tab: WorkspaceTab): void {
    this.service.tab.set(tab);
  }
}
