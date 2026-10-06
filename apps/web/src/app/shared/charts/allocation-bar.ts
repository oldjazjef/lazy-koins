import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ChfPipe } from '../format/number-format';

export interface AllocationPart {
  /** null = "Andere". */
  readonly asset: string | null;
  readonly valueChf: string;
  /** Percent as a decimal string with 2 places. */
  readonly sharePct: string;
  readonly assets: number;
}

/**
 * Distribution by asset as one stacked horizontal bar (F11.7): the largest named, the rest as
 * "Andere"; colours from the fixed categorical tokens (never by rank of anything else), a
 * legend with share and value, the share in each slice's tooltip, and a visually hidden table.
 */
@Component({
  selector: 'lk-allocation-bar',
  imports: [TranslatePipe, ChfPipe],
  templateUrl: './allocation-bar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AllocationBar {
  readonly parts = input.required<readonly AllocationPart[]>();
  readonly label = input.required<string>();

  protected readonly slices = computed(() => {
    let x = 0;
    return this.parts().map((part, index) => {
      // Drawing only: the share as a number for the slice's width.
      const width = Math.max(0, Number(part.sharePct) || 0);
      const slice = {
        part,
        x,
        width,
        colour:
          part.asset === null ? 'lk-alloc-other' : `lk-alloc-${index + 1}`,
      };
      x += width;
      return slice;
    });
  });
}
