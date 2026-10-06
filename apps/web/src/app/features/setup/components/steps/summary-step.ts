import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideCircleCheck } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import type {
  SetupFacts,
  SetupStepId,
  SetupView,
} from '../../../../core/api/setup.types';
import { SetupStateService } from '../../../../core/setup/setup-state.service';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/** One line of the summary: what it is about, whether it is set up, and its step. */
export interface SummaryItem {
  readonly id: keyof SetupFacts;
  readonly step: SetupStepId;
  readonly ok: boolean;
  /** Required for "App starten". */
  readonly required: boolean;
}

/** Which facts the summary lists, in order, and the step that sets each one up. */
const ITEMS: ReadonlyArray<{
  id: keyof SetupFacts;
  step: SetupStepId;
  only?: 'desktop' | 'web';
}> = [
  { id: 'profile', step: 'profile' },
  { id: 'advisor', step: 'advisor' },
  { id: 'ai', step: 'ai' },
  { id: 'onlineRates', step: 'rates' },
  { id: 'coingeckoKey', step: 'rates' },
  { id: 'etherscanKey', step: 'wallets' },
  { id: 'mail', step: 'mail' },
  { id: 'pin', step: 'pin' },
];

/** What is set up and what is missing, with what a gap means (F11.0s step 9). */
export function summaryItems(view: SetupView): SummaryItem[] {
  return ITEMS.map(({ id, step }) => ({
    id,
    step,
    ok: view.facts[id],
    required: view.missing.includes(step),
  }));
}

/**
 * Zusammenfassung: every topic with ✓ or what its absence means ("Ohne CoinGecko-Schlüssel fehlen
 * Kurse für FLR/SGB"), a link back to its step, and "App starten" / "Erstes Projekt anlegen".
 */
@Component({
  selector: 'lk-setup-summary-step',
  imports: [NgIcon, TranslatePipe, ...HlmButtonImports],
  providers: [
    provideSetupStep(() => SummaryStep),
    provideIcons({ lucideCircleAlert, lucideCircleCheck }),
  ],
  template: `
    <ul class="flex flex-col gap-3">
      @for (item of items(); track item.id) {
        <li class="flex items-start gap-3">
          <span
            class="mt-0.5 flex shrink-0"
            [class.lk-positive]="item.ok"
            [class.lk-warning-text]="!item.ok && !item.required"
            [class.text-destructive]="!item.ok && item.required"
            aria-hidden="true"
          >
            <ng-icon
              [name]="item.ok ? 'lucideCircleCheck' : 'lucideCircleAlert'"
              size="18"
            />
          </span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm font-medium">
              {{ 'setup.summary.items.' + item.id + '.title' | translate }}
              <span class="sr-only">{{
                (item.ok ? 'setup.summary.ok' : 'setup.summary.missing')
                  | translate
              }}</span>
            </span>
            <span class="text-muted-foreground text-sm">
              {{
                'setup.summary.items.' +
                  item.id +
                  (item.ok ? '.ok' : '.missing') | translate
              }}
            </span>
          </div>
          @if (!item.ok) {
            <button
              hlmBtn
              variant="link"
              size="sm"
              type="button"
              (click)="open.emit(item.step)"
            >
              {{ 'setup.summary.setUp' | translate }}
            </button>
          }
        </li>
      }
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryStep extends SetupStepComponent {
  private readonly state = inject(SetupStateService);
  /** "Einrichten" next to a gap: back to that step. */
  readonly open = output<SetupStepId>();

  protected readonly items = computed(() => {
    const view = this.state.view();
    return view ? summaryItems(view) : [];
  });

  async submit(): Promise<boolean> {
    return true;
  }
}
