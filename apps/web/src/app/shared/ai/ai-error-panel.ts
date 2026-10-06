import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideCopy } from '@ng-icons/lucide';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import {
  aiErrorReport,
  type AiErrorInfo,
  hasAiErrorDetails,
} from './ai-error-details';

/**
 * A failed AI request, precisely (user rule): the translated summary, a hint for the typical
 * cases and the details — provider status and message, URL, model, error code, system cause —
 * with "Details kopieren". `collapsible` folds the details into a `<details>` (dialogs).
 */
@Component({
  selector: 'lk-ai-error-panel',
  imports: [NgTemplateOutlet, NgIcon, TranslatePipe, ...HlmButtonImports],
  providers: [provideIcons({ lucideCircleAlert, lucideCopy })],
  template: `
    @let info = error();
    <div
      class="border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3 text-sm"
      role="alert"
    >
      <p class="text-destructive flex items-start gap-2 font-medium">
        <ng-icon
          name="lucideCircleAlert"
          size="16"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <span>{{ info.key | translate }}</span>
      </p>
      @if (info.hintKey) {
        <p>{{ info.hintKey | translate }}</p>
      }
      @if (hasDetails()) {
        @if (collapsible()) {
          <details class="flex flex-col gap-2">
            <summary class="text-muted-foreground cursor-pointer text-xs">
              {{ 'ai.details.show' | translate }}
            </summary>
            <ng-container *ngTemplateOutlet="list" />
          </details>
        } @else {
          <ng-container *ngTemplateOutlet="list" />
        }
      }
      <ng-template #list>
        <dl
          class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs"
        >
          @if (info.status !== undefined) {
            <dt class="text-muted-foreground">
              {{ 'ai.details.status' | translate }}
            </dt>
            <dd class="font-mono">{{ info.status }}</dd>
          }
          @if (info.providerMessage) {
            <dt class="text-muted-foreground">
              {{ 'ai.details.providerMessage' | translate }}
            </dt>
            <dd class="font-mono break-words">{{ info.providerMessage }}</dd>
          }
          @if (info.providerType || info.providerCode) {
            <dt class="text-muted-foreground">
              {{ 'ai.details.providerType' | translate }}
            </dt>
            <dd class="font-mono break-all">
              {{ providerKind() }}
            </dd>
          }
          @if (info.url) {
            <dt class="text-muted-foreground">
              {{ 'ai.details.url' | translate }}
            </dt>
            <dd class="font-mono break-all">{{ info.url }}</dd>
          }
          @if (info.model) {
            <dt class="text-muted-foreground">
              {{ 'ai.details.model' | translate }}
            </dt>
            <dd class="font-mono break-all">{{ info.model }}</dd>
          }
          @if (info.code) {
            <dt class="text-muted-foreground">
              {{ 'ai.details.code' | translate }}
            </dt>
            <dd class="font-mono">{{ info.code }}</dd>
          }
          @if (info.cause) {
            <dt class="text-muted-foreground">
              {{ 'ai.details.cause' | translate }}
            </dt>
            <dd class="font-mono break-words">{{ info.cause }}</dd>
          }
          @if (info.detail && !info.providerMessage && !info.cause) {
            <dt class="text-muted-foreground">
              {{ 'ai.details.detail' | translate }}
            </dt>
            <dd class="break-words">{{ info.detail }}</dd>
          }
        </dl>
        <div>
          <button
            hlmBtn
            variant="outline"
            size="sm"
            type="button"
            class="mt-2"
            (click)="copy()"
          >
            <ng-icon name="lucideCopy" size="14" aria-hidden="true" />
            {{
              (copied() ? 'ai.details.copied' : 'ai.details.copy') | translate
            }}
          </button>
        </div>
      </ng-template>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiErrorPanel {
  private readonly translate = inject(TranslateService);

  readonly error = input.required<AiErrorInfo>();
  readonly collapsible = input(false);

  protected readonly copied = signal(false);
  protected readonly hasDetails = computed(() =>
    hasAiErrorDetails(this.error()),
  );
  protected readonly providerKind = computed(() =>
    [this.error().providerType, this.error().providerCode]
      .filter(Boolean)
      .join(' / '),
  );

  protected async copy(): Promise<void> {
    const text = aiErrorReport(this.error(), (key) =>
      this.translate.instant(key),
    );
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
