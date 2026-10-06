import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import type { OpenItem } from '../../../../core/api/calculation.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ChfPipe, QuantityPipe } from '../../../../shared/format/number-format';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';

/**
 * Prüfungen (F8.1) with traffic lights, the open items (F8.2: tick off, note, estimated CHF
 * impact, records behind them) and the previous-year comparison (F8.3).
 */
@Component({
  selector: 'lk-project-checks',
  imports: [
    TranslatePipe,
    Paginator,
    Truncate,
    ChfPipe,
    QuantityPipe,
    EmptyState,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './project-checks.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectChecks {
  protected readonly service = inject(ProjectWorkspaceService);

  readonly closed = input(false);

  protected readonly view = computed(() =>
    this.service.checks.hasValue() ? this.service.checks.value() : undefined,
  );

  /** Open items (F8.2), 10 per page. */
  protected readonly itemsPager = paginate(
    computed(() => this.view()?.items ?? []),
    { storageKey: 'open-items' },
  );

  protected readonly openCount = computed(
    () => this.view()?.items.filter((item) => !item.done).length ?? 0,
  );

  /** Keys of the rows whose note editor is open (the row is "expanded"). */
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected isExpanded(item: OpenItem): boolean {
    return this.expanded().has(item.key);
  }

  protected toggleExpanded(item: OpenItem): void {
    this.expanded.update((keys) => {
      const next = new Set(keys);
      if (!next.delete(item.key)) next.add(item.key);
      return next;
    });
  }

  protected toggle(item: OpenItem, event: Event): void {
    const done = (event.target as HTMLInputElement).checked;
    void this.service.saveItem(item, { done }).catch(() => undefined);
  }

  protected saveNote(item: OpenItem, note: string): void {
    this.toggleExpanded(item);
    if (note.trim() === item.note) return;
    void this.service.saveItem(item, { note }).catch(() => undefined);
  }

  protected where(item: OpenItem): string {
    return [item.platform, item.accountId, item.asset]
      .filter((part) => part !== null && part !== '')
      .join(' · ');
  }

  protected records(item: OpenItem): void {
    void this.service.showRecords(item.key, this.where(item));
  }
}
