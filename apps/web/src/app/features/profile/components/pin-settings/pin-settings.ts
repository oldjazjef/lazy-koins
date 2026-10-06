import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { PinLockService } from '../../../../core/pin/pin-lock.service';
import {
  AUTO_LOCK_CHOICES,
  ChangePinSchema,
  fieldError,
  PIN_PATTERN,
} from '../../../../core/pin/pin.schema';

/**
 * Profil › PIN (F11.0p): change the PIN (the current one required), the auto-lock time, and —
 * on the web, where the PIN is optional — remove it. Without a PIN: set one in the wizard's step.
 */
@Component({
  selector: 'lk-pin-settings',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  templateUrl: './pin-settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinSettings {
  protected readonly pin = inject(PinLockService);
  private readonly notifications = inject(NotificationService);
  protected readonly choices = AUTO_LOCK_CHOICES;
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);

  protected readonly changeForm = inject(FormBuilder).nonNullable.group({
    currentPin: [''],
    pin: [''],
    repeat: [''],
  });

  protected readonly removeForm = inject(FormBuilder).nonNullable.group({
    currentPin: [''],
  });

  constructor() {
    void this.pin.ensure();
  }

  protected changeError(field: 'currentPin' | 'pin' | 'repeat'): string | null {
    if (!this.changeForm.controls[field].touched) return null;
    return fieldError(
      ChangePinSchema.safeParse(this.changeForm.getRawValue()),
      field,
    );
  }

  protected async change(): Promise<void> {
    this.changeForm.markAllAsTouched();
    const parsed = ChangePinSchema.safeParse(this.changeForm.getRawValue());
    if (!parsed.success) return;
    await this.run(
      () => this.pin.setPin(parsed.data.pin, parsed.data.currentPin),
      'pin.changed',
      () => this.changeForm.reset(),
    );
  }

  protected async autoLock(event: Event): Promise<void> {
    const minutes = Number((event.target as HTMLSelectElement).value);
    await this.run(() => this.pin.setAutoLock(minutes), 'pin.autoLockSaved');
  }

  protected async remove(): Promise<void> {
    const currentPin = this.removeForm.getRawValue().currentPin;
    if (!PIN_PATTERN.test(currentPin)) {
      this.problem.set('invalidPin');
      return;
    }
    await this.run(
      () => this.pin.removePin(currentPin),
      'pin.removed',
      () => this.removeForm.reset(),
    );
  }

  private async run(
    work: () => Promise<{ code: string } | null>,
    success: string,
    after?: () => void,
  ): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      const problem = await work();
      if (problem) {
        this.problem.set(problem.code);
        return;
      }
      after?.();
      this.notifications.success(success);
    } finally {
      this.busy.set(false);
    }
  }
}
