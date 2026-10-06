import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import {
  type AttachmentOption,
  type MailComposition,
  SENT_VIA,
  type SentVia,
} from '../../../../core/api/mail.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { SmtpError } from '../../../../shared/components/smtp-error';
import { Truncate } from '../../../../shared/components/truncate';
import { formatBytes } from '../../../../shared/mail/mail-error';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';
import {
  mailtoLink,
  selectedBytes,
  SendToAdvisorService,
} from './send-to-advisor.service';

const ADDRESS =
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]+$/;

/** Today as YYYY-MM-DD in the browser's time zone. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The Exporte tab's "An Treuhänder" card (F10.6a, F4.7): send the mail with the stored statements
 * (compose → explicit confirmation → send), or — without a mailer — copy the text / open it in
 * the mail program; the sent status with "seit dem Versand geändert", mark as sent by hand, undo;
 * and the send log.
 */
@Component({
  selector: 'lk-send-to-advisor',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    SmtpError,
    Paginator,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  providers: [SendToAdvisorService],
  templateUrl: './send-to-advisor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SendToAdvisor {
  protected readonly service = inject(SendToAdvisorService);
  protected readonly workspace = inject(ProjectWorkspaceService);
  private readonly notifications = inject(NotificationService);
  protected readonly ways = SENT_VIA;
  protected readonly bytes = formatBytes;
  protected readonly logPager = paginate(
    computed(() =>
      this.service.log.hasValue() ? this.service.log.value() : [],
    ),
    { storageKey: 'mail-log' },
  );

  /** compose = edit the mail; confirm = the explicit last look before sending. */
  protected readonly step = signal<'compose' | 'confirm'>('compose');
  protected readonly marking = signal(false);
  protected readonly confirmUndo = signal(false);
  /** The statements ticked in the "als gesendet markieren" dialog. */
  protected readonly markExports = signal<ReadonlySet<string>>(new Set());

  protected readonly form = inject(FormBuilder).nonNullable.group({
    to: [''],
    ccMe: [true],
    subject: [''],
    body: [''],
  });

  protected readonly markForm = inject(FormBuilder).nonNullable.group({
    date: [today()],
    via: ['mail' as SentVia],
    to: [''],
    note: [''],
  });

  protected readonly totalBytes = computed(() => {
    const composition = this.service.composition();
    return composition ? selectedBytes(composition) : 0;
  });

  protected readonly tooLarge = computed(() => {
    const composition = this.service.composition();
    return composition
      ? this.totalBytes() > composition.maxAttachmentBytes
      : false;
  });

  protected readonly selected = computed(
    () =>
      this.service.composition()?.attachments.filter((item) => item.selected) ??
      [],
  );

  constructor() {
    effect(() => this.service.projectId.set(this.workspace.projectId()));
  }

  protected async openSend(): Promise<void> {
    this.step.set('compose');
    if (await this.service.open()) {
      const composition = this.service.composition();
      if (composition) this.fill(composition);
    }
  }

  protected dialogState(): 'open' | 'closed' {
    return this.service.composition() ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.service.close();
  }

  /** Ticks an attachment; the text's {{anhaenge}} follows unless the text was edited. */
  protected async toggle(item: AttachmentOption): Promise<void> {
    const composition = this.service.composition();
    if (!composition) return;
    const attachments = composition.attachments.map((a) =>
      a.id === item.id ? { ...a, selected: !a.selected } : a,
    );
    this.service.composition.set({ ...composition, attachments });
    if (this.form.controls.body.pristine) {
      try {
        const again = await this.service.compose(
          attachments.filter((a) => a.selected).map((a) => a.id),
        );
        this.service.composition.update((current) =>
          current ? { ...current, body: again.body } : current,
        );
        this.form.controls.body.setValue(again.body);
        this.form.controls.body.markAsPristine();
      } catch {
        // The selection stays; the text keeps its old list.
      }
    }
  }

  protected canContinue(): boolean {
    const { to, subject, body } = this.form.getRawValue();
    return (
      ADDRESS.test(to.trim()) &&
      subject.trim() !== '' &&
      body.trim() !== '' &&
      !this.tooLarge()
    );
  }

  protected toConfirm(): void {
    this.form.markAllAsTouched();
    if (this.canContinue()) this.step.set('confirm');
  }

  protected async sendNow(): Promise<void> {
    const composition = this.service.composition();
    if (!composition) return;
    const { to, ccMe, subject, body } = this.form.getRawValue();
    await this.service.send({
      to: to.trim(),
      ccMe,
      subject,
      body,
      exportIds: this.selected().map((item) => item.id),
      confirmed: true,
    });
  }

  protected mailto(): string {
    const { to, subject, body } = this.form.getRawValue();
    return mailtoLink(to.trim(), subject, body);
  }

  protected async copy(): Promise<void> {
    const { subject, body } = this.form.getRawValue();
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      this.notifications.success('exports.mail.copied');
    } catch {
      this.notifications.error('exports.mail.copyFailed');
    }
  }

  protected openMark(): void {
    const exports = this.workspace.exports.hasValue()
      ? this.workspace.exports.value()
      : [];
    const latest = new Map<string, string>();
    for (const item of exports) {
      if (!latest.has(item.kind)) latest.set(item.kind, item.id);
    }
    this.markExports.set(new Set(latest.values()));
    this.markForm.reset({ date: today(), via: 'post', to: '', note: '' });
    this.marking.set(true);
  }

  protected toggleMarkExport(id: string): void {
    this.markExports.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected markState(): 'open' | 'closed' {
    return this.marking() ? 'open' : 'closed';
  }

  protected markChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.marking.set(false);
  }

  protected async mark(): Promise<void> {
    const { date, via, to, note } = this.markForm.getRawValue();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) {
      this.notifications.error('projects.sent.dateInvalid');
      return;
    }
    if (
      await this.service.markSent({
        date,
        via,
        to: to.trim(),
        note: note.trim(),
        exportIds: [...this.markExports()],
      })
    ) {
      this.marking.set(false);
    }
  }

  protected undoState(): 'open' | 'closed' {
    return this.confirmUndo() ? 'open' : 'closed';
  }

  protected undoChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.confirmUndo.set(false);
  }

  protected async undo(): Promise<void> {
    if (await this.service.undoSent()) this.confirmUndo.set(false);
  }

  protected today(): string {
    return today();
  }

  private fill(composition: MailComposition): void {
    this.form.reset({
      to: composition.to,
      ccMe: true,
      subject: composition.subject,
      body: composition.body,
    });
  }
}
