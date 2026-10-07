import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  MailComposition,
  MailLogEntry,
  MarkSentRequest,
  ProjectSentStatus,
  SendMailRequest,
  SendMailResult,
  SmtpErrorDetail,
} from '../../../../core/api/mail.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { mailErrorKey, smtpErrorOf } from '../../../../shared/mail/mail-error';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';

/** `mailto:` link of a composed mail — without attachments, which `mailto:` cannot carry. */
export function mailtoLink(to: string, subject: string, body: string): string {
  const query = [
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(body)}`,
  ].join('&');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?${query}`;
}

/** Sum of the selected attachments' sizes. */
export function selectedBytes(composition: MailComposition): number {
  return composition.attachments
    .filter((item) => item.selected)
    .reduce((sum, item) => sum + item.size, 0);
}

/**
 * "An Treuhänder senden" in the Exporte tab (F10.6a) and the project's sent status (F4.7): the
 * composed mail, sending it, the send log, and marking as sent by hand / undoing it. Provided by
 * the component; the project id comes from the workspace. The API decides everything — this
 * service loads, triggers and maps answers to translated messages.
 */
@Injectable()
export class SendToAdvisorService {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);

  readonly projectId = signal<string | undefined>(undefined);

  private url(path: string): string | undefined {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}${path}` as `/${string}`) : undefined;
  }

  readonly log = httpResource<MailLogEntry[]>(() => this.url('/mail/log'));
  /** F4.7; follows sends, marks, exports, calculations, files, corrections (DataChanges). */
  readonly sent = httpResource<ProjectSentStatus>(() => this.url('/sent'));

  constructor() {
    const changes = inject(DataChanges);
    reloadOn(
      () => changes.projectVersion(this.projectId()),
      [this.log, this.sent],
    );
  }

  /** The mail in the dialog (null = dialog closed). */
  readonly composition = signal<MailComposition | null>(null);
  readonly busy = signal(false);
  /** The SMTP details of the last failed send, shown in the dialog. */
  readonly sendError = signal<SmtpErrorDetail | null>(null);

  readonly isSent = computed(
    () => this.sent.hasValue() && this.sent.value().sent !== null,
  );

  /** Opens the dialog: the mail from the template with the preselected statements. */
  async open(): Promise<boolean> {
    this.sendError.set(null);
    try {
      this.composition.set(await this.compose());
      return true;
    } catch (error) {
      this.notifications.error(mailErrorKey(error));
      return false;
    }
  }

  /** The mail again for another attachment selection ({{anhaenge}}). */
  compose(exportIds?: string[]): Promise<MailComposition> {
    return firstValueFrom(
      this.http.post<MailComposition>(
        apiUrl(`/projects/${this.requireId()}/mail/compose`),
        exportIds ? { exportIds } : {},
      ),
    );
  }

  close(): void {
    this.composition.set(null);
    this.sendError.set(null);
  }

  /** Sends after the explicit confirmation; on success the dialog closes and F4.7 is set. */
  async send(request: SendMailRequest): Promise<boolean> {
    this.busy.set(true);
    this.sendError.set(null);
    try {
      const result = await firstValueFrom(
        this.http.post<SendMailResult>(
          apiUrl(`/projects/${this.requireId()}/mail/send`),
          request,
        ),
      );
      this.sent.set(result.sent);
      this.notifications.success('mail.send.sent');
      this.close();
      return true;
    } catch (error) {
      const smtp = smtpErrorOf(error);
      if (smtp) this.sendError.set(smtp);
      this.notifications.error(mailErrorKey(error));
      // A failed send is logged, too — and a failed request reports no change.
      this.log.reload();
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** F4.7 "als gesendet markieren". */
  async markSent(request: MarkSentRequest): Promise<boolean> {
    return this.change(
      () =>
        firstValueFrom(
          this.http.put<ProjectSentStatus>(
            apiUrl(`/projects/${this.requireId()}/sent`),
            request,
          ),
        ),
      'projects.sent.marked',
    );
  }

  /** F4.7 "rückgängig". */
  async undoSent(): Promise<boolean> {
    return this.change(
      () =>
        firstValueFrom(
          this.http.delete<ProjectSentStatus>(
            apiUrl(`/projects/${this.requireId()}/sent`),
          ),
        ),
      'projects.sent.undone',
    );
  }

  private async change(
    work: () => Promise<ProjectSentStatus>,
    message: string,
  ): Promise<boolean> {
    this.busy.set(true);
    try {
      this.sent.set(await work());
      this.notifications.success(message);
      return true;
    } catch {
      this.notifications.error('projects.sent.failed');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private requireId(): string {
    const id = this.projectId();
    if (!id) throw new Error('No project on screen');
    return id;
  }
}
