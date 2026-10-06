import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { SmtpErrorDetail } from '../../../core/api/mail.types';

/**
 * The precise reason a mail failed (F11.10): what went wrong in words, then the server, the SMTP
 * code and its (redacted) answer — what a user needs to fix the settings or ask their provider.
 */
@Component({
  selector: 'lk-smtp-error',
  imports: [TranslatePipe],
  template: `
    @let error = detail();
    <div
      class="border-destructive/40 rounded-md border p-3 text-sm"
      role="alert"
    >
      <p class="text-destructive font-medium">
        {{ 'mail.smtp.kind.' + error.kind | translate }}
      </p>
      <dl class="lk-facts mt-2">
        <dt>{{ 'mail.smtp.server' | translate }}</dt>
        <dd class="font-mono text-xs">{{ error.host }}:{{ error.port }}</dd>
        @if (error.smtpCode !== null) {
          <dt>{{ 'mail.smtp.code' | translate }}</dt>
          <dd class="font-mono text-xs">{{ error.smtpCode }}</dd>
        }
        @if (error.command) {
          <dt>{{ 'mail.smtp.command' | translate }}</dt>
          <dd class="font-mono text-xs">{{ error.command }}</dd>
        }
        @if (error.code) {
          <dt>{{ 'mail.smtp.errorCode' | translate }}</dt>
          <dd class="font-mono text-xs">{{ error.code }}</dd>
        }
        @if (error.response) {
          <dt>{{ 'mail.smtp.response' | translate }}</dt>
          <dd class="font-mono text-xs break-all whitespace-pre-wrap">
            {{ error.response }}
          </dd>
        }
      </dl>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmtpError {
  readonly detail = input.required<SmtpErrorDetail>();
}
