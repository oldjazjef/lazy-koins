import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { AiSettingsForm } from '../../components/ai-settings-form/ai-settings-form';
import { AiSettingsPageService } from './ai-settings-page.service';

/**
 * Settings → AI (F5.13, F5.14): which provider (any OpenAI-compatible API or Anthropic), address,
 * model, key, on/off; test the connection (the form is `lk-ai-settings-form`, shared with the
 * setup wizard); see and withdraw the consent.
 */
@Component({
  selector: 'lk-ai-settings-page',
  imports: [
    DatePipe,
    TranslatePipe,
    PageHeader,
    EmptyState,
    AiSettingsForm,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmSkeletonImports,
  ],
  templateUrl: './ai-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsPage {
  protected readonly service = inject(AiSettingsPageService);

  protected readonly current = computed(() =>
    this.service.settings.hasValue()
      ? this.service.settings.value()
      : undefined,
  );
}
