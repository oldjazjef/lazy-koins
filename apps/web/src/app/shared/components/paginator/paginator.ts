import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronLeft,
  lucideChevronRight,
  lucideChevronsLeft,
  lucideChevronsRight,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { PAGE_SIZES, type Pagination } from './paginate';

let nextId = 0;

/**
 * The bar under a table: „Zeile 11–20 von 57", rows per page (10 / 25 / 50 / 100) and
 * first/previous/next/last. Renders nothing while every row fits on the smallest page.
 * Drive it with `paginate(rows)` and render `pager.visible()` in the table.
 */
@Component({
  selector: 'lk-paginator',
  imports: [NgIcon, TranslatePipe, ...HlmButtonImports, ...HlmInputImports],
  providers: [
    provideIcons({
      lucideChevronLeft,
      lucideChevronRight,
      lucideChevronsLeft,
      lucideChevronsRight,
    }),
  ],
  template: `
    @if (pager().needed()) {
      <nav
        class="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-2 text-sm"
        [attr.aria-label]="'common.pagination.label' | translate"
      >
        <span class="tabular-nums" aria-live="polite">{{
          'common.pagination.range'
            | translate
              : {
                  from: pager().from(),
                  to: pager().to(),
                  total: pager().total(),
                }
        }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2" [for]="sizeId">
            {{ 'common.pagination.pageSize' | translate }}
            <select
              hlmInput
              class="h-8 w-20"
              [id]="sizeId"
              [value]="pager().pageSize()"
              (change)="changeSize($event)"
            >
              @for (size of sizes; track size) {
                <option [value]="size" [selected]="size === pager().pageSize()">
                  {{ size }}
                </option>
              }
            </select>
          </label>
          <span class="tabular-nums">{{
            'common.pagination.page'
              | translate
                : { page: pager().page() + 1, count: pager().pageCount() }
          }}</span>
          <div class="flex items-center">
            <button
              hlmBtn
              variant="ghost"
              size="icon-sm"
              type="button"
              [disabled]="pager().page() === 0"
              [attr.aria-label]="'common.pagination.first' | translate"
              (click)="pager().setPage(0)"
            >
              <ng-icon name="lucideChevronsLeft" size="16" aria-hidden="true" />
            </button>
            <button
              hlmBtn
              variant="ghost"
              size="icon-sm"
              type="button"
              [disabled]="pager().page() === 0"
              [attr.aria-label]="'common.pagination.previous' | translate"
              (click)="pager().setPage(pager().page() - 1)"
            >
              <ng-icon name="lucideChevronLeft" size="16" aria-hidden="true" />
            </button>
            <button
              hlmBtn
              variant="ghost"
              size="icon-sm"
              type="button"
              [disabled]="pager().page() >= pager().pageCount() - 1"
              [attr.aria-label]="'common.pagination.next' | translate"
              (click)="pager().setPage(pager().page() + 1)"
            >
              <ng-icon name="lucideChevronRight" size="16" aria-hidden="true" />
            </button>
            <button
              hlmBtn
              variant="ghost"
              size="icon-sm"
              type="button"
              [disabled]="pager().page() >= pager().pageCount() - 1"
              [attr.aria-label]="'common.pagination.last' | translate"
              (click)="pager().setPage(pager().pageCount() - 1)"
            >
              <ng-icon
                name="lucideChevronsRight"
                size="16"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </nav>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Paginator {
  readonly pager = input.required<Pagination<unknown>>();

  protected readonly sizes = PAGE_SIZES;
  protected readonly sizeId = `lk-page-size-${nextId++}`;

  protected changeSize(event: Event): void {
    this.pager().setPageSize(Number((event.target as HTMLSelectElement).value));
  }
}
