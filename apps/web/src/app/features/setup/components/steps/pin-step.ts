import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { PinLockService } from '../../../../core/pin/pin-lock.service';
import {
  AUTO_LOCK_CHOICES,
  fieldError,
  NewPinSchema,
} from '../../../../core/pin/pin.schema';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/**
 * PIN (F11.0p; desktop required, web optional): 4–8 digits, entered twice, and after how many
 * minutes without activity the app locks. Only a slow hash is stored. With a PIN already set the
 * step only says so — changing it lives in Profil.
 */
@Component({
  selector: 'lk-setup-pin-step',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [provideSetupStep(() => PinStep)],
  template: `
    @if (pin.status()?.hasPin) {
      <p class="lk-panel p-4 text-sm" role="status">
        {{ 'setup.pin.alreadySet' | translate }}
      </p>
    } @else {
      <form
        class="grid gap-5 sm:grid-cols-2"
        [formGroup]="form"
        (ngSubmit)="$event.preventDefault()"
      >
        <div class="flex flex-col gap-2">
          <label hlmLabel for="setup-pin">{{
            'pin.form.pin' | translate
          }}</label>
          <input
            hlmInput
            id="setup-pin"
            type="password"
            inputmode="numeric"
            autocomplete="new-password"
            maxlength="8"
            formControlName="pin"
            [attr.aria-invalid]="error('pin') ? true : null"
            aria-describedby="setup-pin-error"
          />
          @if (error('pin'); as message) {
            <p id="setup-pin-error" class="text-destructive text-sm">
              {{ message | translate }}
            </p>
          }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel for="setup-pin-repeat">{{
            'pin.form.repeat' | translate
          }}</label>
          <input
            hlmInput
            id="setup-pin-repeat"
            type="password"
            inputmode="numeric"
            autocomplete="new-password"
            maxlength="8"
            formControlName="repeat"
            [attr.aria-invalid]="error('repeat') ? true : null"
            aria-describedby="setup-pin-repeat-error"
          />
          @if (error('repeat'); as message) {
            <p id="setup-pin-repeat-error" class="text-destructive text-sm">
              {{ message | translate }}
            </p>
          }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel for="setup-autolock">{{
            'pin.form.autoLock' | translate
          }}</label>
          <select
            hlmInput
            id="setup-autolock"
            formControlName="autoLockMinutes"
          >
            @for (minutes of choices; track minutes) {
              <option [ngValue]="minutes">
                {{ 'pin.form.minutes' | translate: { count: minutes } }}
              </option>
            }
          </select>
        </div>
        <p class="text-muted-foreground text-xs sm:col-span-2">
          {{
            (pin.status()?.mode === 'desktop'
              ? 'setup.pin.desktopHint'
              : 'setup.pin.webHint'
            ) | translate
          }}
        </p>
        @if (problem(); as code) {
          <p class="text-destructive text-sm sm:col-span-2" role="alert">
            {{ 'pin.errors.' + code | translate }}
          </p>
        }
      </form>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinStep extends SetupStepComponent {
  protected readonly pin = inject(PinLockService);
  protected readonly choices = AUTO_LOCK_CHOICES;
  protected readonly problem = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group({
    pin: [''],
    repeat: [''],
    autoLockMinutes: [15],
  });

  constructor() {
    super();
    void this.pin.ensure();
  }

  protected error(field: 'pin' | 'repeat'): string | null {
    if (!this.form.controls[field].touched) return null;
    return fieldError(NewPinSchema.safeParse(this.form.getRawValue()), field);
  }

  async submit(): Promise<boolean> {
    if (this.pin.status()?.hasPin) return true;
    this.form.markAllAsTouched();
    const parsed = NewPinSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return false;
    const problem = await this.pin.setPin(
      parsed.data.pin,
      undefined,
      parsed.data.autoLockMinutes,
    );
    this.problem.set(problem?.code ?? null);
    if (problem) return false;
    this.form.reset();
    return true;
  }
}
