import { Directive, ElementRef, inject } from '@angular/core';
import {
  BrnTooltip,
  type BrnTooltipPosition,
  provideBrnTooltipDefaultOptions,
} from '@spartan-ng/brain/tooltip';
import {
  DEFAULT_TOOLTIP_CONTENT_CLASSES,
  DEFAULT_TOOLTIP_SVG_CLASS,
  tooltipPositionVariants,
} from '@lazykoins/ui/tooltip';
import { hlm } from '@lazykoins/ui/utils';

/**
 * One line, cut with "…"; the full text appears in a tooltip — **only when it is actually cut**
 * (measured on hover/focus, so a short name never gets a pointless tooltip).
 *
 * ```html
 * <td hlmTd class="max-w-0">                     <!-- max-w-0: the cell may shrink below its text -->
 *   <span [lkTruncate]="file.displayName">{{ file.displayName }}</span>
 * </td>
 * ```
 *
 * The host becomes `block truncate` (overflow hidden, ellipsis, nowrap). In a table it needs a
 * width to cut against: `table-fixed` + a `colgroup`, and `max-w-0` on the cell (with `w-full`
 * on the flexible column if the table is not fixed). Pass the same text as the content.
 */
@Directive({
  selector: '[lkTruncate]',
  // HlmTooltip's look on brain's directive: the input of a host directive's own host directive
  // cannot be re-exposed, so HlmTooltip itself cannot be the host directive here.
  providers: [
    provideBrnTooltipDefaultOptions({
      svgClasses: DEFAULT_TOOLTIP_SVG_CLASS,
      tooltipContentClasses: DEFAULT_TOOLTIP_CONTENT_CLASSES,
      arrowClasses: (position: BrnTooltipPosition) =>
        hlm(tooltipPositionVariants({ position })),
      showDelay: 300,
    }),
  ],
  hostDirectives: [
    {
      directive: BrnTooltip,
      inputs: ['brnTooltip: lkTruncate', 'position: lkTruncatePosition'],
    },
  ],
  host: {
    class: 'block min-w-0 truncate',
    '(pointerenter)': 'measure()',
    '(focusin)': 'measure()',
  },
})
export class Truncate {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tooltip = inject(BrnTooltip);

  constructor() {
    this.tooltip.mutableTooltipDisabled.set(true);
  }

  /** Runs before the tooltip's own (timer-delayed) show, so it decides whether one appears. */
  protected measure(): void {
    const el = this.element.nativeElement;
    this.tooltip.mutableTooltipDisabled.set(!(el.scrollWidth > el.clientWidth));
  }
}
