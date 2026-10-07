import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideStar } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';

/**
 * 1–5 stars (F5.17): read-only for an average, or five buttons for my own rating
 * (`aria-pressed` on the chosen one). Filled stars use the primary colour.
 */
@Component({
  selector: 'lk-star-rating',
  imports: [NgIcon, TranslatePipe, ...HlmButtonImports],
  providers: [provideIcons({ lucideStar })],
  template: `
    @if (readonly()) {
      <span class="inline-flex items-center gap-0.5" aria-hidden="true">
        @for (star of stars; track star) {
          <ng-icon
            name="lucideStar"
            size="14"
            [class.text-primary]="star <= rounded()"
            [class.text-muted-foreground]="star > rounded()"
          />
        }
      </span>
      <span class="sr-only">{{
        'library.rating.readable' | translate: { average: value() ?? 0 }
      }}</span>
    } @else {
      <span
        class="inline-flex items-center gap-1"
        role="group"
        [attr.aria-label]="'library.rating.yours' | translate"
      >
        @for (star of stars; track star) {
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            [disabled]="disabled()"
            [attr.aria-pressed]="value() === star"
            [attr.aria-label]="
              'library.rating.stars' | translate: { count: star }
            "
            [class.text-primary]="star <= rounded()"
            [class.text-muted-foreground]="star > rounded()"
            (click)="rated.emit(star)"
          >
            <ng-icon name="lucideStar" size="20" aria-hidden="true" />
          </button>
        }
      </span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StarRating {
  readonly value = input<number | null>(null);
  readonly readonly = input(false);
  readonly disabled = input(false);
  readonly rated = output<number>();

  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly rounded = computed(() => Math.round(this.value() ?? 0));
}
