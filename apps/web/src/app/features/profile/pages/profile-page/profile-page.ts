import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { z } from 'zod';
import { CH_CANTONS } from '../../../../core/api/api.types';
import type { UpdateSettingsRequest } from '../../../../core/api/calculation.types';
import { LanguageService } from '../../../../core/i18n/language.service';
import { LanguageFields } from '../../../../shared/components/language-fields';
import { PageHeader } from '../../../../shared/components/page-header';
import {
  type LanguageChoice,
  languageChoiceOf,
} from '../../../../shared/format/format-options';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { UserSettingsService } from '../../../settings/user-settings.service';
import { PinSettings } from '../../components/pin-settings/pin-settings';
import { ProfilePageService } from './profile-page.service';

export const ProfileSchema = z.object({
  displayName: z.string().trim().max(120, 'profile.errors.tooLong'),
  canton: z.union([z.literal(''), z.enum(CH_CANTONS)]),
  advisorName: z.string().trim().max(120, 'profile.errors.tooLong'),
  advisorEmail: z.union([
    z.literal(''),
    z.string().trim().email('profile.errors.email').max(200),
  ]),
});

/** The form → the API's changes (F11.1). */
export function profileChanges(
  value: z.infer<typeof ProfileSchema>,
): UpdateSettingsRequest {
  return {
    displayName: value.displayName,
    canton: value.canton,
    advisorName: value.advisorName,
    advisorEmail: value.advisorEmail,
  };
}

/**
 * Profil (ANFORDERUNGEN §11, F11.1, F11.2): name, Wohnkanton and Treuhänder for the statements
 * and the mail draft; language, number and date format (applied and saved at once).
 */
@Component({
  selector: 'lk-profile-page',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    PageHeader,
    LanguageFields,
    PinSettings,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
  ],
  providers: [ProfilePageService],
  templateUrl: './profile-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  protected readonly service = inject(UserSettingsService);
  private readonly language = inject(LanguageService);
  protected readonly data = inject(ProfilePageService);
  protected readonly cantons = CH_CANTONS;

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      displayName: [''],
      canton: [''],
      advisorName: [''],
      advisorEmail: [''],
    },
    { validators: zodValidator(ProfileSchema) },
  );

  constructor() {
    effect(() => {
      // Unsaved edits stay when the language is switched (it saves on its own).
      if (!this.service.settings.hasValue() || untracked(() => this.form.dirty))
        return;
      const settings = this.service.settings.value();
      this.form.reset({
        displayName: settings.displayName,
        canton: settings.canton,
        advisorName: settings.advisorName,
        advisorEmail: settings.advisorEmail,
      });
    });
  }

  /** F11.2: the language and formats as stored — or, before the first choice, the current ones. */
  protected readonly languageChoice = computed<LanguageChoice>(() =>
    languageChoiceOf(
      this.service.settings.hasValue() ? this.service.settings.value() : null,
      this.language.locale(),
    ),
  );

  /** Applies at once (no reload) and saves right away — like a toggle, not a form field. */
  protected changeLanguage(choice: LanguageChoice): void {
    this.language.preview(
      choice.locale,
      choice.numberFormat,
      choice.dateFormat,
    );
    void this.service
      .save({
        locale: choice.locale,
        numberFormat: choice.numberFormat,
        dateFormat: choice.dateFormat,
      })
      .catch(() => {
        // Back to what is stored.
        if (this.service.settings.hasValue())
          this.language.apply(this.service.settings.value());
      });
  }

  protected downloadAll(): void {
    void this.data.downloadAll();
  }

  protected importAccount(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.data.importPackage(file).catch(() => undefined);
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    const parsed = ProfileSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return;
    void this.service
      .save(profileChanges(parsed.data))
      .then(() => this.form.markAsPristine())
      .catch(() => undefined);
  }
}
