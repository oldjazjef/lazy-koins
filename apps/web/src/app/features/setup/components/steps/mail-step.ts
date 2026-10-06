import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MailerForm } from '../../../settings/components/mailer-form/mailer-form';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/**
 * Mail (F11.10, optional): the mailer with "Test-Mail an mich senden" and the precise SMTP error
 * (the settings' own form). The text template starts as the built-in default; it can be adapted
 * later in Einstellungen › Mail.
 */
@Component({
  selector: 'lk-setup-mail-step',
  imports: [TranslatePipe, RouterLink, MailerForm],
  providers: [provideSetupStep(() => MailStep)],
  template: `
    <div class="flex flex-col gap-6">
      <lk-mailer-form [embedded]="true" />
      <div class="lk-panel flex flex-col gap-1 p-4">
        <h3 class="text-sm font-semibold">
          {{ 'settings.mail.template.title' | translate }}
        </h3>
        <p class="text-muted-foreground text-sm">
          {{ 'setup.mail.template' | translate }}
          <a
            class="text-primary hover:underline"
            routerLink="/app/settings/mail"
            >{{ 'setup.mail.templateLink' | translate }}</a
          >
        </p>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailStep extends SetupStepComponent {
  private readonly form = viewChild.required(MailerForm);

  submit(): Promise<boolean> {
    return this.form().submit();
  }
}
