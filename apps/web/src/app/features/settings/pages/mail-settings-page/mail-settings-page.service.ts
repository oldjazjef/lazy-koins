import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  MailSettings,
  MailTemplate,
  MailTemplateText,
  RenderedMail,
  SaveMailSettingsRequest,
  SmtpErrorDetail,
  TestMailRequest,
  TestMailResult,
} from '../../../../core/api/mail.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { mailErrorKey, smtpErrorOf } from '../../../../shared/mail/mail-error';

const KEY = 'mail-settings';

/**
 * Einstellungen › Mail (F11.10): the mailer (SMTP; the password write-only — the API returns a
 * hint), "Test-Mail an mich senden" with the form's unsaved values and precise SMTP errors, and
 * the text template with its live preview. Errors are translated from the API's codes.
 */
@Injectable({ providedIn: 'root' })
export class MailSettingsPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);

  readonly settings = httpResource<MailSettings>(() =>
    apiUrl('/mail/settings'),
  );
  readonly template = httpResource<MailTemplate>(() =>
    apiUrl('/mail/template'),
  );

  readonly testing = signal(false);
  readonly testResult = signal<TestMailResult | null>(null);
  readonly testError = signal<SmtpErrorDetail | null>(null);

  /** The text the preview shows (set debounced by the page). */
  readonly previewText = signal<MailTemplateText | null>(null);
  readonly preview = httpResource<RenderedMail>(() => {
    const text = this.previewText();
    return text
      ? { url: apiUrl('/mail/template/preview'), method: 'POST', body: text }
      : undefined;
  });

  private readonly saveAction = defineAction<
    SaveMailSettingsRequest,
    MailSettings
  >({
    run: (request) =>
      firstValueFrom(
        this.http.put<MailSettings>(apiUrl('/mail/settings'), request),
      ),
  });

  private readonly templateAction = defineAction<
    MailTemplateText | null,
    MailTemplate
  >({
    run: (text) =>
      firstValueFrom(
        text
          ? this.http.put<MailTemplate>(apiUrl('/mail/template'), text)
          : this.http.delete<MailTemplate>(apiUrl('/mail/template')),
      ),
  });

  private readonly status = this.actions.status<unknown>(KEY);
  readonly isSaving = computed(() => this.status()?.state === 'pending');

  /** `message` = the success toast; `null` = none (the setup wizard moves on instead). */
  async save(
    request: SaveMailSettingsRequest,
    message: string | null = 'settings.mail.saved',
  ): Promise<boolean> {
    try {
      const saved = await this.actions.run(this.saveAction, request, {
        key: KEY,
        silent: true,
      });
      this.settings.set(saved);
      if (message) this.notifications.success(message);
      return true;
    } catch (error) {
      this.notifications.error(mailErrorKey(error));
      return false;
    }
  }

  removePassword(current: MailSettings): Promise<boolean> {
    return this.save(
      {
        enabled: current.enabled,
        host: current.host,
        port: current.port,
        security: current.security,
        username: current.username,
        fromName: current.fromName,
        fromAddress: current.fromAddress,
        password: '',
      },
      'settings.mail.passwordRemoved',
    );
  }

  /** "Test-Mail an mich senden" with what is in the form (`draft`) or the saved settings. */
  async test(draft?: TestMailRequest): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    this.testError.set(null);
    try {
      this.testResult.set(
        await firstValueFrom(
          this.http.post<TestMailResult>(
            apiUrl('/mail/settings/test'),
            draft ?? {},
          ),
        ),
      );
    } catch (error) {
      const smtp = smtpErrorOf(error);
      if (smtp) this.testError.set(smtp);
      else this.notifications.error(mailErrorKey(error));
    } finally {
      this.testing.set(false);
    }
  }

  /** Saves the template (`text`) or resets it to the default (`null`). */
  async saveTemplate(text: MailTemplateText | null): Promise<boolean> {
    try {
      const saved = await this.actions.run(this.templateAction, text, {
        key: KEY,
        silent: true,
      });
      this.template.set(saved);
      this.notifications.success(
        text ? 'settings.mail.template.saved' : 'settings.mail.template.reset',
      );
      return true;
    } catch (error) {
      this.notifications.error(mailErrorKey(error));
      return false;
    }
  }
}
