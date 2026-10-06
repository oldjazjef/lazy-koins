import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEllipsisVertical } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDropdownMenuImports } from '@lazykoins/ui/dropdown-menu';
import { HlmTooltipImports } from '@lazykoins/ui/tooltip';

/** One action of a table row. */
export interface RowAction<Id extends string = string> {
  readonly id: Id;
  /** i18n key of the label (menu text, tooltip and aria-label). */
  readonly labelKey: string;
  /** The icon's SVG — import it from `@ng-icons/lucide` (`lucideEye`), no registration needed. */
  readonly icon: string;
  /** Destructive (remove, delete): listed last, after a separator, in the danger colour. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** Not offered at all for this row (e.g. a closed project). */
  readonly hidden?: boolean;
}

/**
 * The actions cell of a table row (user rule: the interaction area never moves or wraps).
 * Exactly one visible action → a plain icon button with a tooltip; more → one "⋯" button that
 * opens a menu (icon + label, destructive actions last). Emits the chosen action's id.
 *
 * ```html
 * <td hlmTd class="lk-sticky-actions text-right">
 *   <lk-row-actions [actions]="actionsFor(file)" (selected)="act($event, file)" />
 * </td>
 * ```
 */
@Component({
  selector: 'lk-row-actions',
  imports: [
    NgIcon,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmDropdownMenuImports,
    ...HlmTooltipImports,
  ],
  providers: [provideIcons({ lucideEllipsisVertical })],
  host: {
    class: 'inline-flex justify-end',
    // A row that opens on click (the project list) must not open when its actions are used.
    '(click)': '$event.stopPropagation()',
  },
  template: `
    @if (single(); as action) {
      <button
        hlmBtn
        variant="ghost"
        size="icon-sm"
        type="button"
        [class.text-destructive]="action.danger"
        [disabled]="action.disabled"
        [attr.aria-label]="action.labelKey | translate"
        [hlmTooltip]="action.labelKey | translate"
        (click)="selected.emit(action.id)"
      >
        <ng-icon [svg]="action.icon" size="16" aria-hidden="true" />
      </button>
    } @else if (visible().length > 1) {
      <button
        hlmBtn
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-haspopup="menu"
        [attr.aria-label]="'common.actions' | translate"
        [hlmDropdownMenuTrigger]="menu"
        align="end"
      >
        <ng-icon name="lucideEllipsisVertical" size="16" aria-hidden="true" />
      </button>
      <ng-template #menu>
        <hlm-dropdown-menu class="min-w-48">
          @for (action of regular(); track action.id) {
            <button
              hlmDropdownMenuItem
              type="button"
              [disabled]="action.disabled ?? false"
              (triggered)="selected.emit(action.id)"
            >
              <ng-icon [svg]="action.icon" size="16" aria-hidden="true" />
              {{ action.labelKey | translate }}
            </button>
          }
          @if (regular().length > 0 && dangerous().length > 0) {
            <hlm-dropdown-menu-separator />
          }
          @for (action of dangerous(); track action.id) {
            <button
              hlmDropdownMenuItem
              type="button"
              variant="destructive"
              [disabled]="action.disabled ?? false"
              (triggered)="selected.emit(action.id)"
            >
              <ng-icon [svg]="action.icon" size="16" aria-hidden="true" />
              {{ action.labelKey | translate }}
            </button>
          }
        </hlm-dropdown-menu>
      </ng-template>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowActions<Id extends string = string> {
  readonly actions = input.required<readonly RowAction<Id>[]>();
  readonly selected = output<Id>();

  protected readonly visible = computed(() =>
    this.actions().filter((action) => !action.hidden),
  );
  protected readonly single = computed(() => {
    const visible = this.visible();
    return visible.length === 1 ? visible[0] : undefined;
  });
  protected readonly regular = computed(() =>
    this.visible().filter((action) => !action.danger),
  );
  protected readonly dangerous = computed(() =>
    this.visible().filter((action) => action.danger),
  );
}
