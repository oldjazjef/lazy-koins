import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBan, lucideCircleCheck, lucideCircleX } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import type { ProposalView } from '../api/assistant.types';
import { ChatService } from './chat.service';

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
  readonly proposal = input.required<ProposalView>();
}
