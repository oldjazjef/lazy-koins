import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { z } from 'zod';
import type { AssistantSettings } from '../../../../core/api/assistant.types';
import { AssistantSettingsService } from './assistant-settings.service';

/** The prompt may be empty (= the default) and at most `max` characters long. */
export function assistantPromptSchema(max: number) {
  return z.string().max(max, 'assistant.prompt.tooLong');
}

/**
 * Einstellungen › AI › Assistent (F11.15): the system prompt (own or default), the safety rules
 * that apply on top of it — always, read-only — and the chat's consent.
 */
@Component({
  selector: 'lk-assistant-settings-section',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './assistant-settings-section.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantSettingsSection {
  protected readonly service = inject(AssistantSettingsService);
  protected readonly prompt = new FormControl('', { nonNullable: true });
  protected readonly error = signal<string | null>(null);

  protected readonly current = computed<AssistantSettings | undefined>(() =>
    this.service.settings.hasValue()
      ? this.service.settings.value()
      : undefined,
  );

  constructor() {
    // The saved prompt (again after each save) unless the user is editing.
    effect(() => {
      const settings = this.current();
      if (settings && this.prompt.pristine) this.fill(settings);
    });
  }

  protected async save(settings: AssistantSettings): Promise<void> {
    const parsed = assistantPromptSchema(settings.maxLength).safeParse(
      this.prompt.value,
    );
    if (!parsed.success) {
      this.error.set(parsed.error.issues[0]?.message ?? null);
      return;
    }
    this.error.set(null);
    if (await this.service.savePrompt(parsed.data)) this.refill();
  }

  protected async reset(): Promise<void> {
    this.error.set(null);
    if (await this.service.resetPrompt()) this.refill();
  }

  private refill(): void {
    this.prompt.markAsPristine();
    const settings = this.current();
    if (settings) this.fill(settings);
  }

  private fill(settings: AssistantSettings): void {
    this.prompt.reset(settings.systemPrompt, { emitEvent: false });
  }
}
