import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';

/**
 * The page's single `<h1>`, with a back button on detail pages and an optional subtitle. Actions
 * (a "Neues Projekt" button) are projected into the right-hand slot. Pass translated text.
 * It stays at the top while the page content scrolls (user rule, `lk-page-header` in styles.css);
 * an element marked `lkPageHeaderBelow` (a tab bar) goes under the title, inside the sticky part.
 */
@Component({
  selector: 'lk-page-header',
  imports: [NgIcon, TranslatePipe, ...HlmButtonImports],
  providers: [provideIcons({ lucideChevronLeft })],
  template: `
    <header class="lk-page-header">
      <div class="flex flex-wrap items-center gap-3">
        @if (back()) {
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            (click)="location.back()"
            [attr.aria-label]="'common.back' | translate"
          >
            <ng-icon name="lucideChevronLeft" size="20" />
          </button>
        }
        <!-- basis-48: on a narrow screen the actions wrap below the title instead of squeezing it. -->
        <div class="min-w-0 flex-1 basis-48">
          <h1 class="truncate text-2xl font-semibold">{{ title() }}</h1>
          @if (subtitle(); as text) {
            <p class="text-muted-foreground text-sm">{{ text }}</p>
          }
        </div>
        <ng-content />
      </div>
      <!-- A tab bar under the title (project workspace), part of the sticky header. -->
      <ng-content select="[lkPageHeaderBelow]" />
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly back = input(false);
  protected readonly location = inject(Location);
}
