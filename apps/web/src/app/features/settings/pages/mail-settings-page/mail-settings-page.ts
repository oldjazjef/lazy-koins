import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { debounceTime } from 'rxjs';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import type { MailTemplate } from '../../../../core/api/mail.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { MailerForm } from '../../components/mailer-form/mailer-form';
import { MailTemplateFormSchema } from './mail-settings.schema';
import { MailSettingsPageService } from './mail-settings-page.service';

/**
 * Einstellungen › Mail (F11.10): the mailer (`lk-mailer-form`, shared with the setup wizard —
 * SMTP server, port, security, user, password, sender, on/off, "Test-Mail an mich senden"), and
 * the text template of the mail to the Treuhänder with placeholders, a live preview and "auf
 * Standard zurücksetzen".
 */
@Component({
  selector: 'lk-mail-settings-page',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    PageHeader,
    EmptyState,
    MailerForm,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './mail-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailSettingsPage {
  protected readonly service = inject(MailSettingsPageService);

  protected readonly templateForm = inject(FormBuilder).nonNullable.group(
    { subject: [''], body: [''] },
    { validators: zodValidator(MailTemplateFormSchema) },
  );

  protected readonly confirmReset = signal(false);

  protected readonly current = computed(() =>
    this.service.settings.hasValue()
      ? this.service.settings.value()
      : undefined,
  );

  protected readonly template = computed(() =>
    this.service.template.hasValue()
      ? this.service.template.value()
      : undefined,
  );

  /** The live preview: of what is typed, else of the stored template. */
  protected readonly preview = computed(() =>
    this.service.preview.hasValue()
      ? this.service.preview.value()
      : this.template()?.preview,
  );

  constructor() {
    // Fill the form from the saved template (again after each save) unless the user is editing.
    effect(() => {
      const template = this.template();
      if (template && this.templateForm.pristine) this.fillTemplate(template);
    });
    this.templateForm.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => {
        const { subject, body } = this.templateForm.getRawValue();
        this.service.previewText.set({ subject, body });
      });
  }

  /** `{{name}}` — built here: braces cannot be written inside a template interpolation. */
  protected token(name: string): string {
    return `{{${name}}}`;
  }

  /** Puts `{{name}}` where the cursor is in the text. */
  protected insert(textarea: HTMLTextAreaElement, name: string): void {
    const token = this.token(name);
    const value = this.templateForm.controls.body.value;
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    this.templateForm.controls.body.setValue(
      value.slice(0, start) + token + value.slice(end),
    );
    this.templateForm.markAsDirty();
    queueMicrotask(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }

  protected async saveTemplate(): Promise<void> {
    this.templateForm.markAllAsTouched();
    const parsed = MailTemplateFormSchema.safeParse(
      this.templateForm.getRawValue(),
    );
    if (!parsed.success) return;
    if (await this.service.saveTemplate(parsed.data)) {
      this.templateForm.markAsPristine();
      const template = this.template();
      if (template) this.fillTemplate(template);
    }
  }

  protected async resetTemplate(): Promise<void> {
    this.confirmReset.set(false);
    if (await this.service.saveTemplate(null)) {
      this.templateForm.markAsPristine();
      const template = this.template();
      if (template) this.fillTemplate(template);
      this.service.previewText.set(null);
    }
  }

  protected resetState(): 'open' | 'closed' {
    return this.confirmReset() ? 'open' : 'closed';
  }

  protected resetChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.confirmReset.set(false);
  }

  private fillTemplate(template: MailTemplate): void {
    this.templateForm.reset(
      { subject: template.subject, body: template.body },
      { emitEvent: false },
    );
  }
}
