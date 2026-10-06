import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type { OpenItem } from '../../../../core/api/calculation.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ChfPipe, QuantityPipe } from '../../../../shared/format/number-format';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';

/**
 * Prüfungen (F8.1) with traffic lights, the open items (F8.2: tick off, note, estimated CHF
 * impact, records behind them) and the previous-year comparison (F8.3).
 */
@Component({
  selector: 'lk-project-checks',
  imports: [
    TranslatePipe,
    ChfPipe,
    QuantityPipe,
    EmptyState,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
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

  protected readonly openCount = computed(
    () => this.view()?.items.filter((item) => !item.done).length ?? 0,
  );

  protected toggle(item: OpenItem, event: Event): void {
    const done = (event.target as HTMLInputElement).checked;
    void this.service.saveItem(item, { done }).catch(() => undefined);
  }

  protected saveNote(item: OpenItem, event: Event): void {
    const note = (event.target as HTMLInputElement).value;
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
