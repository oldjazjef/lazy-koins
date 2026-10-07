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
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { ProfileSchema } from '../../../profile/pages/profile-page/profile-page';
import { UserSettingsService } from '../../../settings/user-settings.service';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/** The Treuhänder fields of the profile's own schema. */
const AdvisorSchema = ProfileSchema.pick({
  advisorName: true,
  advisorEmail: true,
});

/**
 * Treuhänder (F11.1, optional): name and address — the "An Treuhänder senden" mail goes there.
 * Same schema and endpoint as Profil.
 */
@Component({
  selector: 'lk-setup-advisor-step',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [provideSetupStep(() => AdvisorStep)],
  template: `
    <form
      class="grid gap-5 sm:grid-cols-2"
      [formGroup]="form"
      (ngSubmit)="$event.preventDefault()"
    >
      <div class="flex flex-col gap-2">
        <label hlmLabel for="setup-advisor">{{
          'profile.fields.advisorName' | translate
        }}</label>
        <input
          hlmInput
          id="setup-advisor"
          type="text"
          formControlName="advisorName"
        />
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="setup-advisor-mail">{{
          'profile.fields.advisorEmail' | translate
        }}</label>
        <input
          hlmInput
          id="setup-advisor-mail"
          type="email"
          autocomplete="off"
          formControlName="advisorEmail"
        />
        @if (
          form.controls.advisorEmail.touched &&
            form.controls.advisorEmail.errors?.['zod'];
          as error
        ) {
          <p class="text-destructive text-sm">{{ error | translate }}</p>
        }
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvisorStep extends SetupStepComponent {
  private readonly settings = inject(UserSettingsService);

  readonly form = inject(FormBuilder).nonNullable.group(
    { advisorName: [''], advisorEmail: [''] },
    { validators: zodValidator(AdvisorSchema) },
  );

  constructor() {
    super();
    effect(() => {
      if (!this.settings.settings.hasValue() || this.form.dirty) return;
      const value = this.settings.settings.value();
      this.form.reset({
        advisorName: value.advisorName,
        advisorEmail: value.advisorEmail,
      });
    });
  }

  async submit(): Promise<boolean> {
    this.form.markAllAsTouched();
    const parsed = AdvisorSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return false;
    if (this.form.pristine) return true;
    try {
      await this.settings.save(parsed.data, { quiet: true });
      this.form.markAsPristine();
      return true;
    } catch {
      return false;
    }
  }
}
