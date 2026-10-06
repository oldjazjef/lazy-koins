import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type { FigureRecord } from '../../../core/api/calculation.types';
import { QuantityPipe } from '../../format/number-format';

/** A record with, on the dashboard, the project it was read from. */
export type RecordRow = FigureRecord & { readonly projectId?: string | null };

/**
 * F7.5 drill-down: the records behind a figure with file and row, the raw row on demand. Used
 * by the project workspace and the dashboard (F11.6). `title` null = closed; `data` null =
 * still loading.
 */
@Component({
  selector: 'lk-records-dialog',
  imports: [
    DatePipe,
    RouterLink,
    TranslatePipe,
    QuantityPipe,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  templateUrl: './records-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordsDialog {
  readonly title = input<string | null>(null);
  readonly data = input<{
    readonly total: number;
    readonly records: readonly RecordRow[];
  } | null>(null);
  readonly closed = output<void>();

  protected state(): 'open' | 'closed' {
    return this.title() !== null ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed') this.closed.emit();
  }

  protected rawEntries(raw: Record<string, string> | null): [string, string][] {
    return raw ? Object.entries(raw) : [];
  }
}
