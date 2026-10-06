import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { MailConnectionDraft } from './application/mail-gate';
import {
  GetMailSettingsQuery,
  type MailSettingsView,
  SaveMailSettingsCommand,
  type SaveMailSettingsInput,
  SendTestMailCommand,
  type TestMailResult,
} from './application/mail-settings.handlers';
import {
  GetMailTemplateQuery,
  type MailTemplateView,
  PreviewMailTemplateQuery,
  ResetMailTemplateCommand,
  SaveMailTemplateCommand,
} from './application/mail-template.handlers';
import {
  ComposeMailQuery,
  ListMailLogQuery,
  type MailComposition,
  SendMailCommand,
  type SendMailInput,
  type SendMailResult,
} from './application/send-mail.handlers';
import type { MailLogEntry } from './domain/mail-log';
import type {
  MailLanguage,
  MailTemplateText,
  RenderedMail,
} from './domain/mail-template';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class MailService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  settings(userId: string): Promise<MailSettingsView> {
    return this.queries.execute(new GetMailSettingsQuery(userId));
  }

  saveSettings(
    userId: string,
    input: SaveMailSettingsInput,
  ): Promise<MailSettingsView> {
    return this.commands.execute(new SaveMailSettingsCommand(userId, input));
  }

  sendTest(
    userId: string,
    draft?: MailConnectionDraft,
  ): Promise<TestMailResult> {
    return this.commands.execute(new SendTestMailCommand(userId, draft));
  }

  template(userId: string, language: MailLanguage): Promise<MailTemplateView> {
    return this.queries.execute(new GetMailTemplateQuery(userId, language));
  }

  saveTemplate(
    userId: string,
    language: MailLanguage,
    text: MailTemplateText,
  ): Promise<MailTemplateView> {
    return this.commands.execute(
      new SaveMailTemplateCommand(userId, language, text),
    );
  }

  resetTemplate(
    userId: string,
    language: MailLanguage,
  ): Promise<MailTemplateView> {
    return this.commands.execute(
      new ResetMailTemplateCommand(userId, language),
    );
  }

  previewTemplate(text: MailTemplateText): Promise<RenderedMail> {
    return this.queries.execute(new PreviewMailTemplateQuery(text));
  }

  compose(
    userId: string,
    projectId: string,
    exportIds?: readonly string[],
  ): Promise<MailComposition> {
    return this.queries.execute(
      new ComposeMailQuery(userId, projectId, exportIds),
    );
  }

  send(
    userId: string,
    projectId: string,
    input: SendMailInput,
  ): Promise<SendMailResult> {
    return this.commands.execute(new SendMailCommand(userId, projectId, input));
  }

  log(userId: string, projectId: string): Promise<MailLogEntry[]> {
    return this.queries.execute(new ListMailLogQuery(userId, projectId));
  }
}
