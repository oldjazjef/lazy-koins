import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmTableImports } from '@lazykoins/ui/table';
import type { MappingPreview } from '../../../../core/api/api.types';

/**
 * What a mapping read from a file: totals, the first bookings and balances, the row errors. Used
 * by the assignment dialog and the mapping editor. Quantities are shown as the API's decimal
 * strings — exactly, never through `Number()`.
 */
@Component({
  selector: 'lk-mapping-preview',
  imports: [DatePipe, TranslatePipe, ...HlmTableImports],
  templateUrl: './mapping-preview.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingPreviewView {
  readonly preview = input.required<MappingPreview>();
}
