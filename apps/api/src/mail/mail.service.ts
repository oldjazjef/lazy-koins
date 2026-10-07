import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { isLocale, localeOr } from '../common/i18n/locale';
import {
  GetSettingsQuery,
  type SettingsView,
} from '../settings/application/settings.handlers';
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

  /**
   * F11.2: the requested language, else the user's — the default template exists per language
   * (F11.10).
   */
  async languageOf(userId: string, requested?: string): Promise<MailLanguage> {
    if (isLocale(requested)) return requested;
    const settings: SettingsView = await this.queries.execute(
      new GetSettingsQuery(userId),
    );
    return localeOr(settings.locale);
  }

  async template(userId: string, language?: string): Promise<MailTemplateView> {
    return this.queries.execute(
      new GetMailTemplateQuery(userId, await this.languageOf(userId, language)),
    );
  }

  async saveTemplate(
    userId: string,
    language: string | undefined,
    text: MailTemplateText,
  ): Promise<MailTemplateView> {
    return this.commands.execute(
      new SaveMailTemplateCommand(
        userId,
        await this.languageOf(userId, language),
        text,
      ),
    );
  }

  async resetTemplate(
    userId: string,
    language?: string,
  ): Promise<MailTemplateView> {
    return this.commands.execute(
      new ResetMailTemplateCommand(
        userId,
        await this.languageOf(userId, language),
      ),
    );
  }

  async previewTemplate(
    userId: string,
    text: MailTemplateText,
    language?: string,
  ): Promise<RenderedMail> {
    return this.queries.execute(
      new PreviewMailTemplateQuery(
        text,
        await this.languageOf(userId, language),
      ),
    );
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
