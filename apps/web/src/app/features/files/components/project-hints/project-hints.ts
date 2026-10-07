import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideChevronDown,
  lucideChevronRight,
  lucideInfo,
  lucideRotateCcw,
  lucideUpload,
  lucideX,
} from '@ng-icons/lucide';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import {
  type FileRowErrors,
  HINT_KINDS,
  HINT_STATUSES,
  type HintKind,
  type HintSeverity,
  type HintStatus,
  type ProjectFile,
  type ProjectHint,
} from '../../../../core/api/api.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import {
  paginate,
  type Pagination,
  Paginator,
} from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { AiAssistState } from '../ai-assist';
import { ProjectFilesService } from '../project-files/project-files.service';
import {
  type HintAction,
  hintActions,
  hintsByPlatform,
  type HintSort,
  sortHints,
} from './project-hints.logic';

type Dialog =
  | { readonly kind: 'dismiss'; readonly hint: ProjectHint }
  | { readonly kind: 'upload'; readonly hint: ProjectHint }
  | {
      readonly kind: 'rowErrors';
      readonly hint: ProjectHint;
      readonly errors: FileRowErrors | null;
    };

/** A request to the workspace (other tabs): prefilled manual holding, or the checks. */
export interface ManualHoldingRequest {
  readonly platform: string;
  readonly accountId: string;
}

/**
 * "Hinweise" (F5.8): what may be missing or wrong in the project's files, as a table grouped by
 * platform — type (severity colour), account, short description, date, status — with the
 * fixing actions per type, "Als in Ordnung markieren" (with a note) and "Wieder öffnen".
 * Dismissals are stored per project under the hint's stable key and survive recalculation.
 * Links to the open items of the checks for the same platform/account (and back).
 */
@Component({
  selector: 'lk-project-hints',
  imports: [
    LkDatePipe,
    FormsModule,
    NgIcon,
    TranslatePipe,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  providers: [
    provideIcons({
      lucideCheck,
      lucideChevronDown,
      lucideChevronRight,
      lucideRotateCcw,
      lucideUpload,
      lucideX,
    }),
  ],
  templateUrl: './project-hints.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectHints {
  protected readonly service = inject(ProjectFilesService);
  private readonly ai = inject(AiAssistState);
  private readonly translate = inject(TranslateService);

  /** F4.5: a closed project shows the hints but changes nothing. */
  readonly closed = input(false);
  /** Open items of the checks per `platform|account` (and `platform|*`), from the workspace. */
  readonly openItems = input<ReadonlyMap<string, number>>(new Map());

  readonly manualHolding = output<ManualHoldingRequest>();
  readonly showChecks = output<string | null>();
  /** The mapping assignment lives in the files tab. */
  readonly showFiles = output<void>();

  protected readonly kinds = HINT_KINDS;
  protected readonly statuses = HINT_STATUSES;

  protected readonly kindFilter = signal<HintKind | ''>('');
  protected readonly statusFilter = signal<HintStatus | ''>('open');
  protected readonly sort = signal<HintSort>('severity');
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly note = signal('');
  protected readonly dragging = signal(false);

  protected readonly view = computed(() =>
    this.service.hints.hasValue() ? this.service.hints.value() : undefined,
  );

  protected readonly visible = computed(() => {
    const view = this.view();
    if (!view) return [];
    const kind = this.kindFilter();
    const status = this.statusFilter();
    const platform = this.service.hintPlatform();
    return view.hints.filter(
      (hint) =>
        (kind === '' || hint.kind === kind) &&
        (status === '' || hint.status === status) &&
        (platform === null || hint.platform === platform),
    );
  });

  protected readonly groups = computed(() =>
    hintsByPlatform(sortHints(this.visible(), this.sort())),
  );

  protected readonly dismissedCount = computed(
    () => this.view()?.hints.filter((h) => h.status !== 'open').length ?? 0,
  );

  constructor() {
    // A link from the checks narrows to one platform: show every status of it.
    effect(() => {
      if (this.service.hintPlatform() !== null) {
        untracked(() => this.statusFilter.set(''));
      }
    });
  }

  /** The fixing actions per hint key (built once per change of hints/files/closed). */
  private readonly fixes = computed(() => {
    const files = this.service.files();
    return new Map(
      (this.view()?.hints ?? []).map(
        (hint) => [hint.key, hintActions(hint, files)] as const,
      ),
    );
  });

  /** The row menu per hint key (user rule: actions behind "⋯"). */
  private readonly rowActions = computed(() => {
    const closed = this.closed();
    const expanded = this.expanded();
    return new Map(
      (this.view()?.hints ?? []).map((hint) => {
        const open = hint.status === 'open';
        const actions: RowAction[] = [
          ...(this.fixes().get(hint.key) ?? []).map((fix) => ({
            id: fix.kind,
            labelKey: fix.label,
            icon: fix.icon,
            hidden: closed || !open,
          })),
          {
            id: 'markOk',
            labelKey: 'hints.actions.markOk',
            icon: lucideCheck,
            hidden: closed || !open,
          },
          {
            id: 'reopen',
            labelKey: 'hints.actions.reopen',
            icon: lucideRotateCcw,
            hidden: closed || open,
          },
          {
            id: 'details',
            labelKey: expanded.has(hint.key) ? 'hints.less' : 'hints.more',
            icon: lucideInfo,
          },
        ];
        return [hint.key, actions] as const;
      }),
    );
  });

  /** One pager per platform group (10 rows per page, the chosen size remembered). */
  private readonly pagers = new Map<string, Pagination<ProjectHint>>();

  protected pagerFor(platform: string): Pagination<ProjectHint> {
    let pager = this.pagers.get(platform);
    if (!pager) {
      pager = paginate(
        computed(
          () =>
            this.groups().find((group) => group.platform === platform)?.hints ??
            [],
        ),
        {
          storageKey: 'hints',
          resetOn: () => [
            this.kindFilter(),
            this.statusFilter(),
            this.sort(),
            this.service.hintPlatform(),
          ],
        },
      );
      this.pagers.set(platform, pager);
    }
    return pager;
  }

  protected actionsOf(hint: ProjectHint): readonly HintAction[] {
    return this.fixes().get(hint.key) ?? [];
  }

  protected rowActionsFor(hint: ProjectHint): readonly RowAction[] {
    return this.rowActions().get(hint.key) ?? [];
  }

  protected act(id: string, hint: ProjectHint): void {
    switch (id) {
      case 'markOk':
        this.openDismiss(hint);
        return;
      case 'reopen':
        this.reopen(hint);
        return;
      case 'details':
        this.toggleRow(hint);
        return;
    }
    const fix = this.actionsOf(hint).find((action) => action.kind === id);
    if (fix) this.run(hint, fix);
  }

  protected severityClass(severity: HintSeverity): string {
    return `lk-severity lk-severity-${severity}`;
  }

  /** The account(s) or file of a hint; "ganze Plattform" when it names none. */
  protected whereOf(hint: ProjectHint): string {
    if (hint.fileName) return hint.fileName;
    return (
      hint.accountId ||
      hint.accounts.join(', ') ||
      this.translate.instant('hints.wholePlatform')
    );
  }

  /** F5.7a: the deactivated files that would cover this hint, as one text; null when none. */
  protected disabledNamesOf(hint: ProjectHint): string | null {
    const files = hint.disabledFiles ?? [];
    return files.length > 0 ? files.map((file) => file.name).join(', ') : null;
  }

  protected openItemsOf(hint: ProjectHint): number {
    const items = this.openItems();
    if (!hint.platform) return 0;
    if (hint.accountId) {
      return items.get(`${hint.platform}|${hint.accountId}`) ?? 0;
    }
    return items.get(`${hint.platform}|*`) ?? 0;
  }

  protected toggleGroup(platform: string): void {
    this.collapsed.update((keys) => toggled(keys, platform));
  }

  protected toggleRow(hint: ProjectHint): void {
    this.expanded.update((keys) => toggled(keys, hint.key));
  }

  protected setSort(sort: HintSort): void {
    this.sort.set(sort);
  }

  protected clearPlatform(): void {
    this.service.hintPlatform.set(null);
    this.statusFilter.set('open');
  }

  // --- Actions ---

  protected run(hint: ProjectHint, action: HintAction): void {
    switch (action.kind) {
      case 'upload':
        this.dialog.set({ kind: 'upload', hint });
        return;
      case 'aiStatement':
      case 'aiMapping': {
        const file = this.fileById(action.fileId);
        if (file) {
          void this.ai.start(
            file,
            action.kind === 'aiStatement' ? 'statement' : 'mapping',
          );
        }
        return;
      }
      case 'manualHolding':
        this.manualHolding.emit({
          platform: hint.platform ?? '',
          accountId: hint.accountId || (hint.accounts[0] ?? ''),
        });
        return;
      case 'template':
        void this.service.downloadTemplate(
          hint.kind === 'noYearEndBalance' ? 'holdings' : 'bookings',
        );
        return;
      case 'assign':
        if (action.fileId) {
          this.service.requestAssign(action.fileId);
          this.showFiles.emit();
        }
        return;
      case 'rowErrors':
        void this.openRowErrors(hint);
        return;
    }
  }

  protected openDismiss(hint: ProjectHint): void {
    this.note.set(hint.note);
    this.dialog.set({ kind: 'dismiss', hint });
  }

  protected dismiss(hint: ProjectHint, status: 'done' | 'ignored'): void {
    const note = this.note();
    this.dialog.set(null);
    void this.service.setHintStatus(hint, status, note).catch(() => undefined);
  }

  protected reopen(hint: ProjectHint): void {
    void this.service.setHintStatus(hint, 'open').catch(() => undefined);
  }

  private async openRowErrors(hint: ProjectHint): Promise<void> {
    if (!hint.fileId) return;
    this.dialog.set({ kind: 'rowErrors', hint, errors: null });
    try {
      const errors = await this.service.rowErrors({ id: hint.fileId });
      const current = this.dialog();
      if (current?.kind === 'rowErrors' && current.hint.key === hint.key) {
        this.dialog.set({ kind: 'rowErrors', hint, errors });
      }
    } catch {
      this.dialog.set(null);
    }
  }

  // --- Upload dialog (prefilled for the platform) ---

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = [...(target.files ?? [])];
    target.value = '';
    this.uploadFiles(files);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.uploadFiles([...(event.dataTransfer?.files ?? [])]);
  }

  private uploadFiles(files: File[]): void {
    if (files.length === 0) return;
    this.dialog.set(null);
    void this.service.upload(files);
  }

  protected dialogState(kind: Dialog['kind']): 'open' | 'closed' {
    return this.dialog()?.kind === kind ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.dialog.set(null);
  }

  private fileById(id: string | undefined): ProjectFile | undefined {
    return id ? this.service.files().find((f) => f.id === id) : undefined;
  }
}

function toggled(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}
