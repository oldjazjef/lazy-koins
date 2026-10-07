import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import {
  MAIL_SECURITIES,
  type MailSecurity,
  type MailSettings,
} from '../../../../core/api/mail.types';
import { SmtpError } from '../../../../shared/components/smtp-error';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { MailSettingsFormSchema } from '../../pages/mail-settings-page/mail-settings.schema';
import { MailSettingsPageService } from '../../pages/mail-settings-page/mail-settings-page.service';

/** The usual port of each security mode, offered when the user switches it. */
const DEFAULT_PORTS: Readonly<Record<MailSecurity, number>> = {
  starttls: 587,
  tls: 465,
  none: 25,
};

/**
 * The mailer form (F11.10): SMTP server, port, security, user, password (write-only), sender,
 * on/off and "Test-Mail an mich senden" with the precise SMTP error. Shared by Einstellungen ›
 * Mail and the setup wizard (F11.0s); `embedded` hides the save button — "Weiter" calls
 * `submit()`.
 */
@Component({
  selector: 'lk-mailer-form',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    SmtpError,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  templateUrl: './mailer-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailerForm {
  readonly embedded = input(false);
  protected readonly service = inject(MailSettingsPageService);
  protected readonly securities = MAIL_SECURITIES;

  readonly form = inject(FormBuilder).nonNullable.group(
    {
      enabled: [false],
      host: [''],
      port: [587],
      security: ['starttls' as MailSecurity],
      username: [''],
      password: [''],
      fromName: [''],
      fromAddress: [''],
    },
    { validators: zodValidator(MailSettingsFormSchema) },
  );

  protected readonly current = computed(() =>
    this.service.settings.hasValue()
      ? this.service.settings.value()
      : undefined,
  );

  constructor() {
    // Fill the form from the saved values (again after each save) unless the user is editing.
    effect(() => {
      const settings = this.current();
      if (settings && this.form.pristine) this.fill(settings);
    });
  }

  protected securityChanged(): void {
    const { security, port } = this.form.getRawValue();
    if (Object.values(DEFAULT_PORTS).includes(port)) {
      this.form.controls.port.setValue(DEFAULT_PORTS[security]);
    }
  }

  /** Saves the form; true when saved or nothing changed. */
  async submit(): Promise<boolean> {
    this.form.markAllAsTouched();
    const parsed = MailSettingsFormSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return false;
    if (this.form.pristine) return true;
    const { password, ...rest } = parsed.data;
    const saved = await this.service.save(
      {
        ...rest,
        ...(password !== '' ? { password } : {}),
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

  /** Tests what is in the form right now — saved or not; a typed password is used, never stored. */
  protected test(): void {
    const parsed = MailSettingsFormSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) {
      this.form.markAllAsTouched();
      return;
    }
    const { enabled: _enabled, password, ...rest } = parsed.data;
    void this.service.test({
      ...rest,
      ...(password !== '' ? { password } : {}),
    });
  }

  protected async removePassword(settings: MailSettings): Promise<void> {
    if (await this.service.removePassword(settings)) this.form.markAsPristine();
  }

  private fill(settings: MailSettings): void {
    this.form.reset(
      {
        enabled: settings.enabled,
        host: settings.host,
        port: settings.port,
        security: settings.security,
        username: settings.username,
        password: '',
        fromName: settings.fromName,
        fromAddress: settings.fromAddress,
      },
      { emitEvent: false },
    );
  }
}
