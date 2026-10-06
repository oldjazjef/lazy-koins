import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { z } from 'zod';
import { CH_CANTONS } from '../../../../core/api/api.types';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { UserSettingsService } from '../../../settings/user-settings.service';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/** Step 1 (required): the name and the Wohnkanton the statements need (F11.1). */
export const ProfileStepSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'setup.profile.nameRequired')
    .max(120, 'profile.errors.tooLong'),
  canton: z.enum(CH_CANTONS, 'setup.profile.cantonRequired'),
});

/**
 * Profil (F11.1, F11.2): name and Wohnkanton (required), the language — Deutsch (Schweiz) only so
 * far — and the number/date format (de-CH). Saved through the settings (`PUT /api/settings`).
 */
@Component({
  selector: 'lk-setup-profile-step',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [provideSetupStep(() => ProfileStep)],
  template: `
    <form
      class="grid gap-5 sm:grid-cols-2"
      [formGroup]="form"
      (ngSubmit)="$event.preventDefault()"
    >
      <div class="flex flex-col gap-2">
        <label hlmLabel for="setup-name">{{
          'profile.fields.displayName' | translate
        }}</label>
        <input
          hlmInput
          id="setup-name"
          type="text"
          autocomplete="name"
          formControlName="displayName"
          [attr.aria-invalid]="error('displayName') ? true : null"
          aria-describedby="setup-name-error"
        />
        @if (error('displayName'); as message) {
          <p id="setup-name-error" class="text-destructive text-sm">
            {{ message | translate }}
          </p>
        }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="setup-canton">{{
          'profile.fields.canton' | translate
        }}</label>
        <select
          hlmInput
          id="setup-canton"
          formControlName="canton"
          [attr.aria-invalid]="error('canton') ? true : null"
          aria-describedby="setup-canton-error"
        >
          <option value="">{{ 'profile.noCanton' | translate }}</option>
          @for (canton of cantons; track canton) {
            <option [value]="canton">{{ canton }}</option>
          }
        </select>
        @if (error('canton'); as message) {
          <p id="setup-canton-error" class="text-destructive text-sm">
            {{ message | translate }}
          </p>
        }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="setup-language">{{
          'setup.profile.language' | translate
        }}</label>
        <select hlmInput id="setup-language" disabled>
          <option>{{ 'setup.profile.languageDeCH' | translate }}</option>
        </select>
        <p class="text-muted-foreground text-xs">
          {{ 'setup.profile.languageHint' | translate }}
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="setup-format">{{
          'setup.profile.format' | translate
        }}</label>
        <select hlmInput id="setup-format" disabled>
          <option>
            {{ 'profile.numberFormats.deCH' | translate }} ·
            {{ 'profile.dateFormats.ddMMyyyy' | translate }}
          </option>
        </select>
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileStep extends SetupStepComponent {
  private readonly settings = inject(UserSettingsService);
  protected readonly cantons = CH_CANTONS;

  readonly form = inject(FormBuilder).nonNullable.group(
    { displayName: [''], canton: [''] },
    { validators: zodValidator(ProfileStepSchema) },
  );

  constructor() {
    super();
    effect(() => {
      if (!this.settings.settings.hasValue() || this.form.dirty) return;
      const value = this.settings.settings.value();
      this.form.reset({
        displayName: value.displayName,
        canton: value.canton,
      });
    });
  }

  /** The field's message key while it is touched and wrong. */
  protected error(field: 'displayName' | 'canton'): string | null {
    const control = this.form.controls[field];
    if (!control.touched) return null;
    const parsed = ProfileStepSchema.shape[field].safeParse(control.value);
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  }

  async submit(): Promise<boolean> {
    this.form.markAllAsTouched();
    const parsed = ProfileStepSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return false;
    try {
      await this.settings.save(parsed.data, { quiet: true });
      this.form.markAsPristine();
      return true;
    } catch {
      return false;
    }
  }
}
