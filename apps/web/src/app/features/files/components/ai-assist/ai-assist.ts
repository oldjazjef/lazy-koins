import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSparkles } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { BOOKING_KINDS } from '../../../../core/api/api.types';
import { AiErrorPanel } from '../../../../shared/ai/ai-error-panel';
import { MappingPreviewView } from '../mapping-preview';
import { AiAssistState } from './ai-assist.state';

/**
 * The dialogs of the AI flows (state in `AiAssistState`): pick a file, "not switched on", the
 * payload + consent (F5.14), progress, and the review of a mapping or of PDF balances.
 */
@Component({
  selector: 'lk-ai-assist',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    MappingPreviewView,
    AiErrorPanel,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  providers: [provideIcons({ lucideSparkles })],
  templateUrl: './ai-assist.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAssist {
  protected readonly state = inject(AiAssistState);

  protected readonly title = computed(() =>
    this.state.mode() === 'mapping' ? 'ai.mapping.title' : 'ai.statement.title',
  );

  /** Kinds in the standard format's order, only those that occur. */
  protected readonly kindCounts = computed(() => {
    const counts = this.state.candidate()?.kindCounts ?? {};
    return BOOKING_KINDS.filter((kind) => (counts[kind] ?? 0) > 0).map(
      (kind) => ({ kind, count: counts[kind] ?? 0 }),
    );
  });

  protected dialogState(): 'open' | 'closed' {
    return this.state.step() === 'closed' ? 'closed' : 'open';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.state.close();
  }
}
