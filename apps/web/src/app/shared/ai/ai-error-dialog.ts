import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { AiErrorNotifier } from './ai-error-notifier';
import { AiErrorPanel } from './ai-error-panel';

/** The "Details" dialog of an AI error toast (mounted once in the app root). */
@Component({
  selector: 'lk-ai-error-dialog',
  imports: [
    TranslatePipe,
    AiErrorPanel,
    ...HlmButtonImports,
    ...HlmDialogImports,
  ],
  template: `
    <hlm-dialog
      [state]="state()"
      (stateChanged)="$event === 'closed' && notifier.close()"
    >
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-2xl">
        <hlm-dialog-header>
          <h3 hlmDialogTitle>{{ 'ai.errorDetails.title' | translate }}</h3>
        </hlm-dialog-header>
        <div class="lk-dialog-body">
          @if (notifier.details(); as error) {
            <lk-ai-error-panel [error]="error" />
          }
        </div>
        <hlm-dialog-footer>
          <button hlmBtn variant="outline" type="button" hlmDialogClose>
            {{ 'common.close' | translate }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiErrorDialog {
  protected readonly notifier = inject(AiErrorNotifier);
  protected readonly state = computed(() =>
    this.notifier.details() ? 'open' : 'closed',
  );
}
