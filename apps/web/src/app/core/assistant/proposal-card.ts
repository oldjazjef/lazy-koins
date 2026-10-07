import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBan, lucideCircleCheck, lucideCircleX } from '@ng-icons/lucide';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import type { ProposalView } from '../api/assistant.types';
import { ChatService } from './chat.service';
import { type ShownProposal, shownProposal } from './proposal-text';

/**
 * A change the assistant proposes (F11.14): what, the before → after values and how risky; the
 * user runs it ("Ausführen") or drops it ("Abbrechen"). Afterwards the outcome replaces the
 * buttons.
 */
@Component({
  selector: 'lk-proposal-card',
  imports: [
    RouterLink,
    NgIcon,
    TranslatePipe,
    ...HlmBadgeImports,
    ...HlmButtonImports,
  ],
  providers: [provideIcons({ lucideBan, lucideCircleCheck, lucideCircleX })],
  templateUrl: './proposal-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalCard {
  protected readonly chat = inject(ChatService);
  private readonly translate = inject(TranslateService);
  readonly proposal = input.required<ProposalView>();

  /** F11.2: summary, lines and failure in the user's language — again after a switch. */
  protected readonly shown = computed<ShownProposal>(() => {
    this.translate.currentLang();
    return shownProposal(this.translate, this.proposal());
  });
}
