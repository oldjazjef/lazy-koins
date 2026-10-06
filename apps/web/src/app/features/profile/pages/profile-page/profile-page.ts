import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
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
import { PageHeader } from '../../../../shared/components/page-header';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { UserSettingsService } from '../../../settings/user-settings.service';
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
 * and the mail draft, number and date format (only de-CH so far; the language follows).
 */
@Component({
  selector: 'lk-profile-page',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    PageHeader,
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
      if (!this.service.settings.hasValue()) return;
      const settings = this.service.settings.value();
      this.form.reset({
        displayName: settings.displayName,
        canton: settings.canton,
        advisorName: settings.advisorName,
        advisorEmail: settings.advisorEmail,
      });
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
    void this.service.save(profileChanges(parsed.data)).catch(() => undefined);
  }
}
