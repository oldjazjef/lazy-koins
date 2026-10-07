import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmTableImports } from '@lazykoins/ui/table';
import type { MappingPreview } from '../../../../core/api/api.types';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';

/**
 * What a mapping read from a file: totals, the first bookings and balances, the row errors. Used
 * by the assignment dialog and the mapping editor. Quantities are shown as the API's decimal
 * strings — exactly, never through `Number()`.
 */
@Component({
  selector: 'lk-mapping-preview',
  imports: [LkDatePipe, TranslatePipe, Paginator, Truncate, ...HlmTableImports],
  templateUrl: './mapping-preview.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingPreviewView {
  readonly preview = input.required<MappingPreview>();

  /** The bookings read, 10 per page; back to page 1 for a new preview. */
  protected readonly pager = paginate(
    computed(() => this.preview().bookings),
    { storageKey: 'mapping-preview' },
  );
}
