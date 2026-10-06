import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideCircleCheck } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import type { KeyCheckResult } from '../../../../core/api/setup.types';

/**
 * The outcome of a key test ("Testen", F11.0s, user rule "genaue Fehlerinfos"): ok with the time,
 * or what went wrong — the reason in words, a hint, and the details (HTTP status, the provider's
 * own message, the address called). Never the key.
 */
@Component({
  selector: 'lk-key-check-result',
  imports: [NgIcon, TranslatePipe],
  providers: [provideIcons({ lucideCircleAlert, lucideCircleCheck })],
  template: `
    @let check = result();
    @if (check.ok) {
      <p
        class="lk-panel flex items-center gap-2 p-3 text-sm"
        role="status"
        aria-live="polite"
      >
        <ng-icon
          name="lucideCircleCheck"
          size="16"
          class="text-primary shrink-0"
          aria-hidden="true"
        />
        {{ 'settings.keyTest.ok' | translate: { millis: check.millis } }}
      </p>
    } @else {
      <div
        class="lk-panel border-destructive/50 flex flex-col gap-2 p-3 text-sm"
        role="alert"
      >
        <p class="text-destructive flex items-center gap-2 font-medium">
          <ng-icon
            name="lucideCircleAlert"
            size="16"
            class="shrink-0"
            aria-hidden="true"
          />
          {{
            'settings.keyTest.codes.' + (check.code ?? 'providerError')
              | translate
          }}
        </p>
        <p class="text-muted-foreground">
          {{
            'settings.keyTest.hints.' + (check.code ?? 'providerError')
              | translate
          }}
        </p>
        <dl class="lk-facts text-xs">
          @if (check.status !== null) {
            <dt>{{ 'settings.keyTest.status' | translate }}</dt>
            <dd class="font-mono">{{ check.status }}</dd>
          }
          @if (check.providerMessage; as message) {
            <dt>{{ 'settings.keyTest.message' | translate }}</dt>
            <dd class="font-mono break-all">{{ message }}</dd>
          }
          <dt>{{ 'settings.keyTest.url' | translate }}</dt>
          <dd class="font-mono break-all">{{ check.url }}</dd>
        </dl>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyCheckResultPanel {
  readonly result = input.required<KeyCheckResult>();
}
