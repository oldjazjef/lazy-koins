import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import {
  AI_PROVIDERS,
  type AiProvider,
  type AiSettings,
} from '../../../../core/api/api.types';
import { AiErrorPanel } from '../../../../shared/ai/ai-error-panel';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { AiSettingsFormSchema } from './ai-settings.schema';
import { AI_PRESETS, AiSettingsPageService } from './ai-settings-page.service';

/**
 * Settings → AI (F5.13, F5.14): which provider (any OpenAI-compatible API or Anthropic), address,
 * model, key, on/off; test the connection; see and withdraw the consent.
 */
@Component({
  selector: 'lk-ai-settings-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    NgIcon,
    TranslatePipe,
    PageHeader,
    AiErrorPanel,
    EmptyState,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
  ],
  providers: [provideIcons({ lucideCircleCheck })],
  templateUrl: './ai-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsPage {
  protected readonly service = inject(AiSettingsPageService);
  protected readonly providers = AI_PROVIDERS;

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      enabled: [false],
      provider: ['openai_compatible' as AiProvider],
      baseUrl: [''],
      model: [''],
      apiKey: [''],
    },
    { validators: zodValidator(AiSettingsFormSchema) },
  );

  protected readonly current = computed(() =>
    this.service.settings.hasValue()
      ? this.service.settings.value()
      : undefined,
  );

  /** Local presets only where the server allows private addresses. */
  protected readonly presets = computed(() => {
    const settings = this.current();
    return AI_PRESETS.filter(
      (preset) => !preset.local || settings?.privateUrlsAllowed !== false,
    );
  });

  constructor() {
    // Fill the form from the saved settings (again after each save) unless the user is editing.
    effect(() => {
      const settings = this.current();
      if (settings && this.form.pristine) this.fill(settings);
    });
  }

  protected applyPreset(id: string): void {
    const preset = AI_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.form.patchValue({
      provider: preset.provider,
      baseUrl: preset.baseUrl,
    });
    this.form.markAsDirty();
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    const parsed = AiSettingsFormSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return;
    const { apiKey, ...rest } = parsed.data;
    const saved = await this.service.save({
      ...rest,
      ...(apiKey !== '' ? { apiKey } : {}),
    });
    if (saved) {
      this.form.markAsPristine();
      const settings = this.current();
      if (settings) this.fill(settings);
    }
  }

  /** Tests what is in the form right now — saved or not; a typed key is used, never stored. */
  protected test(): void {
    const { provider, baseUrl, model, apiKey } = this.form.getRawValue();
    void this.service.test({
      provider,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
    });
  }

  protected async removeKey(settings: AiSettings): Promise<void> {
    if (await this.service.removeKey(settings)) this.form.markAsPristine();
  }

  private fill(settings: AiSettings): void {
    this.form.reset(
      {
        enabled: settings.enabled,
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: '',
      },
      { emitEvent: false },
    );
  }
}
