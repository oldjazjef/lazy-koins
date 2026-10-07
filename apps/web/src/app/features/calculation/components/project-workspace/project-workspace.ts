import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ChatContextService } from '../../../../core/assistant/chat-context.service';
import { RecordsDialog } from '../../../../shared/components/records-dialog';
import { AiAssist, AiAssistState } from '../../../files/components/ai-assist';
import { ProjectFiles } from '../../../files/components/project-files';
import { ProjectWallets } from '../../../wallets/components/project-wallets';
import { ProjectFilesService } from '../../../files/components/project-files/project-files.service';
import {
  type ManualHoldingRequest,
  ProjectHints,
} from '../../../files/components/project-hints';
import { MappingEditorState } from '../../../files/components/project-mappings/mapping-editor.state';
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
    ProjectHints,
    AiAssist,
    ProjectRates,
    ProjectResult,
    ProjectChecks,
    ProjectCorrections,
    ProjectExports,
  ],
  // The files area's state is shared with the Hinweise tab, whose actions open its dialogs.
  providers: [
    ProjectWorkspaceService,
    ProjectFilesService,
    MappingEditorState,
    AiAssistState,
  ],
  templateUrl: './project-workspace.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectWorkspace {
  protected readonly service = inject(ProjectWorkspaceService);
  protected readonly files = inject(ProjectFilesService);
  protected readonly tabs = WORKSPACE_TABS;
  private readonly chatContext = inject(ChatContextService);
  /** `?tab=<tab>&figure=<figure id>` — links from the assistant (F11.14). */
  private readonly queryParams = toSignal(inject(ActivatedRoute).queryParamMap);

  readonly projectId = input.required<string>();
  readonly closed = input(false);
  readonly taxYear = input.required<number>();
  /** F4.1a: the project's tax currency. */
  readonly taxCurrency = input('CHF');
  /** A tab to show, e.g. from a notification's link (`?tab=hints`); unknown values are ignored. */
  readonly initialTab = input<string | undefined>();

  /** Open (unticked) items of the checks per `platform|account` and `platform|*` (F8.2 ↔ F5.8). */
  protected readonly openItems = computed(() => {
    const counts = new Map<string, number>();
    const checks = this.service.checks.hasValue()
      ? this.service.checks.value()
      : undefined;
    for (const item of checks?.items ?? []) {
      if (item.done || !item.platform) continue;
      for (const key of [
        `${item.platform}|${item.accountId ?? ''}`,
        `${item.platform}|*`,
      ]) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  });

  constructor() {
    effect(() => {
      const id = this.projectId();
      this.service.projectId.set(id);
      this.files.projectId.set(id);
      this.chatContext.projectId.set(id);
    });
    // The assistant asks with the tab on screen as context.
    effect(() => this.chatContext.tab.set(this.service.tab()));
    inject(DestroyRef).onDestroy(() =>
      this.chatContext.clear(untracked(this.projectId)),
    );
    // `?tab=result&figure=pos:…`: that tab, and the records behind the figure (F7.5).
    effect(() => {
      const params = this.queryParams();
      const tab = params?.get('tab');
      const figure = params?.get('figure');
      untracked(() => {
        if (tab && (WORKSPACE_TABS as readonly string[]).includes(tab)) {
          this.service.tab.set(tab as WorkspaceTab);
        }
        if (figure) void this.service.showRecords(figure, figure);
      });
    });
    // F4.1a: the project's currency (the change itself makes the result stale — the PATCH is a
    // project change, so DataChanges refetches the result).
    effect(() => this.service.projectCurrency.set(this.taxCurrency()));
    effect(() => {
      const tab = this.initialTab();
      if (tab && (WORKSPACE_TABS as readonly string[]).includes(tab)) {
        this.service.tab.set(tab as WorkspaceTab);
      }
    });
  }

  /** "Bestand manuell erfassen" from a hint: the manual holding at 31.12., prefilled. */
  protected manualHolding(request: ManualHoldingRequest): void {
    this.service.startCorrection({
      type: 'manual_holding',
      values: {
        platform: request.platform,
        accountId: request.accountId,
        date: `${this.taxYear()}-12-31`,
      },
    });
  }

  /** From the checks to the hints of one platform (and back via `showChecks`). */
  protected showHints(platform: string | null): void {
    this.files.hintPlatform.set(platform);
    this.service.tab.set('hints');
  }

  protected select(tab: WorkspaceTab): void {
    this.service.tab.set(tab);
  }
}
