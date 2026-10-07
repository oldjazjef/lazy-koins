import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import {
  AI_PROVIDERS,
  type AiProvider,
  type AiSettings,
} from '../../../../core/api/api.types';
import { AiErrorPanel } from '../../../../shared/ai/ai-error-panel';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { AiSettingsFormSchema } from '../../pages/ai-settings-page/ai-settings.schema';
import {
  AI_PRESETS,
  AiSettingsPageService,
} from '../../pages/ai-settings-page/ai-settings-page.service';

/** Where a preset's key comes from (the provider's own page) — F11.0s "Wo bekomme ich den Schlüssel?". */
export const AI_KEY_PAGES: Readonly<Record<string, string>> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  mistral: 'https://console.mistral.ai/api-keys',
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/keys',
  ollama: 'https://ollama.com/download',
  lmstudio: 'https://lmstudio.ai/',
};

/**
 * The AI plugin's form (F5.13): presets, provider, model, address, key (write-only), on/off,
 * "Verbindung testen" with the precise error panel. Shared by Einstellungen › AI and the setup
 * wizard (F11.0s); `embedded` hides the save button — the wizard's "Weiter" calls `submit()`.
 */
@Component({
  selector: 'lk-ai-settings-form',
  imports: [
    ReactiveFormsModule,
    NgIcon,
    TranslatePipe,
    AiErrorPanel,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [provideIcons({ lucideCircleCheck })],
  templateUrl: './ai-settings-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsForm {
  readonly embedded = input(false);
  protected readonly service = inject(AiSettingsPageService);
  protected readonly providers = AI_PROVIDERS;
  protected readonly keyPages = AI_KEY_PAGES;

  readonly form = inject(FormBuilder).nonNullable.group(
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
      enabled: true,
    });
    this.form.markAsDirty();
  }

  /** Saves the form; true when saved (or nothing to save). `extra` = e.g. the wizard's consent. */
  async submit(extra: { giveConsent?: boolean } = {}): Promise<boolean> {
    this.form.markAllAsTouched();
    const parsed = AiSettingsFormSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return false;
    if (this.form.pristine && !extra.giveConsent) return true;
    const { apiKey, ...rest } = parsed.data;
    const saved = await this.service.save(
      {
        ...rest,
        ...(apiKey !== '' ? { apiKey } : {}),
        ...extra,
      },
      this.embedded() ? null : undefined,
    );
    if (saved) {
      this.form.markAsPristine();
      const settings = this.current();
      if (settings) this.fill(settings);
    }
    return saved;
  }

  protected save(): void {
    void this.submit();
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
