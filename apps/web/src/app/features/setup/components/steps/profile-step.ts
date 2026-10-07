import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { z } from 'zod';
import { CH_CANTONS } from '../../../../core/api/api.types';
import { LanguageService } from '../../../../core/i18n/language.service';
import { LanguageFields } from '../../../../shared/components/language-fields';
import {
  type LanguageChoice,
  languageChoiceOf,
} from '../../../../shared/format/format-options';
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
 * Profil (F11.1, F11.2): name and Wohnkanton (required), the language — the browser's until
 * changed; a change switches the wizard at once — and the number/date format. Saved through the
 * settings (`PUT /api/settings`) with "Weiter".
 */
@Component({
  selector: 'lk-setup-profile-step',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    LanguageFields,
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
      <!-- F11.2: the wizard switches language at once; saved with "Weiter" -->
      <div class="grid gap-5 sm:col-span-2 sm:grid-cols-3">
        <lk-language-fields
          [idPrefix]="'setup'"
          [choice]="choice()"
          (choiceChange)="changeLanguage($event)"
        />
        <p class="text-muted-foreground text-xs sm:col-span-3">
          {{ 'setup.profile.languageHint' | translate }}
        </p>
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileStep extends SetupStepComponent {
  private readonly settings = inject(UserSettingsService);
  private readonly language = inject(LanguageService);
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

  /** F11.2: the language (and its formats) chosen here — the browser's until changed. */
  private readonly chosen = signal<LanguageChoice | null>(null);
  protected readonly choice = computed<LanguageChoice>(
    () =>
      this.chosen() ??
      languageChoiceOf(
        this.settings.settings.hasValue()
          ? this.settings.settings.value()
          : null,
        this.language.locale(),
      ),
  );

  /** The wizard is in the new language at once. */
  protected changeLanguage(choice: LanguageChoice): void {
    this.chosen.set(choice);
    this.language.preview(
      choice.locale,
      choice.numberFormat,
      choice.dateFormat,
    );
  }

  async submit(): Promise<boolean> {
    this.form.markAllAsTouched();
    const parsed = ProfileStepSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return false;
    const { locale, numberFormat, dateFormat } = this.choice();
    try {
      await this.settings.save(
        { ...parsed.data, locale, numberFormat, dateFormat },
        { quiet: true },
      );
      this.form.markAsPristine();
      return true;
    } catch {
      return false;
    }
  }
}
