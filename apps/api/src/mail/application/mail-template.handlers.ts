import { Injectable } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  DEFAULT_MAIL_TEMPLATES,
  MAIL_PLACEHOLDERS,
  type MailLanguage,
  type MailPlaceholder,
  type MailTemplate,
  type MailTemplateText,
  placeholdersIn,
  renderMail,
  type RenderedMail,
  SAMPLE_MAIL_VALUES_BY_LANGUAGE,
} from '../domain/mail-template';
import { MailTemplateRepositoryPort } from '../ports/mail.repository.port';
import { mailUnprocessable } from './mail-gate';

/** The user's template (or the default of the language), read in one place. */
@Injectable()
export class MailTemplates {
  constructor(private readonly templates: MailTemplateRepositoryPort) {}

  async of(userId: string, language: MailLanguage): Promise<MailTemplate> {
    return (
      (await this.templates.find(userId, language)) ?? {
        language,
        ...DEFAULT_MAIL_TEMPLATES[language],
        updatedAt: null,
      }
    );
  }
}

/** F11.10 as the settings page sees it: the template, the default, the placeholders, a preview. */
export interface MailTemplateView {
  readonly language: MailLanguage;
  readonly subject: string;
  readonly body: string;
  /** Nothing stored: the default applies. */
  readonly isDefault: boolean;
  readonly defaultSubject: string;
  readonly defaultBody: string;
  readonly placeholders: readonly MailPlaceholder[];
  /** Sample values of the live preview. */
  readonly sampleValues: Readonly<Record<MailPlaceholder, string>>;
  readonly preview: RenderedMail;
}

export function templateView(template: MailTemplate): MailTemplateView {
  const defaults = DEFAULT_MAIL_TEMPLATES[template.language];
  return {
    language: template.language,
    subject: template.subject,
    body: template.body,
    isDefault: template.updatedAt === null,
    defaultSubject: defaults.subject,
    defaultBody: defaults.body,
    placeholders: MAIL_PLACEHOLDERS,
    sampleValues: SAMPLE_MAIL_VALUES_BY_LANGUAGE[template.language],
    preview: renderMail(
      template,
      SAMPLE_MAIL_VALUES_BY_LANGUAGE[template.language],
    ),
  };
}

export class GetMailTemplateQuery {
  constructor(
    readonly userId: string,
    readonly language: MailLanguage,
  ) {}
}

@QueryHandler(GetMailTemplateQuery)
export class GetMailTemplateHandler implements IQueryHandler<
  GetMailTemplateQuery,
  MailTemplateView
> {
  constructor(private readonly templates: MailTemplates) {}

  async execute({
    userId,
    language,
  }: GetMailTemplateQuery): Promise<MailTemplateView> {
    return templateView(await this.templates.of(userId, language));
  }
}

export class SaveMailTemplateCommand {
  constructor(
    readonly userId: string,
    readonly language: MailLanguage,
    readonly text: MailTemplateText,
  ) {}
}

/**
 * Stores the user's template. Unknown placeholders are refused (422 `unknownPlaceholders`, with
 * the list) — they would reach the Treuhänder as `{{…}}`; the preview flags them while typing.
 */
@CommandHandler(SaveMailTemplateCommand)
export class SaveMailTemplateHandler implements ICommandHandler<
  SaveMailTemplateCommand,
  MailTemplateView
> {
  constructor(private readonly templates: MailTemplateRepositoryPort) {}

  async execute({
    userId,
    language,
    text,
  }: SaveMailTemplateCommand): Promise<MailTemplateView> {
    const subject = text.subject.trim();
    const body = text.body.replace(/\r\n?/g, '\n').trimEnd();
    if (subject === '' || body.trim() === '') {
      throw mailUnprocessable('emptyMail', 'Subject and text are required');
    }
    const unknown = [
      ...new Set([
        ...placeholdersIn(subject).unknown,
        ...placeholdersIn(body).unknown,
      ]),
    ];
    if (unknown.length > 0) {
      throw mailUnprocessable(
        'unknownPlaceholders',
        `Unknown placeholders: ${unknown.map((name) => `{{${name}}}`).join(', ')}`,
        { placeholders: unknown },
      );
    }
    return templateView(
      await this.templates.save(userId, language, { subject, body }),
    );
  }
}

export class ResetMailTemplateCommand {
  constructor(
    readonly userId: string,
    readonly language: MailLanguage,
  ) {}
}

/** "auf Standard zurücksetzen": the own template is removed, the default applies again. */
@CommandHandler(ResetMailTemplateCommand)
export class ResetMailTemplateHandler implements ICommandHandler<
  ResetMailTemplateCommand,
  MailTemplateView
> {
  constructor(
    private readonly repository: MailTemplateRepositoryPort,
    private readonly templates: MailTemplates,
  ) {}

  async execute({
    userId,
    language,
  }: ResetMailTemplateCommand): Promise<MailTemplateView> {
    await this.repository.remove(userId, language);
    return templateView(await this.templates.of(userId, language));
  }
}

export class PreviewMailTemplateQuery {
  constructor(
    readonly text: MailTemplateText,
    readonly language: MailLanguage = 'de-CH',
  ) {}
}

/** The live preview of unsaved text with the sample values — nothing stored, no user data. */
@QueryHandler(PreviewMailTemplateQuery)
export class PreviewMailTemplateHandler implements IQueryHandler<
  PreviewMailTemplateQuery,
  RenderedMail
> {
  async execute({
    text,
    language,
  }: PreviewMailTemplateQuery): Promise<RenderedMail> {
    return renderMail(text, SAMPLE_MAIL_VALUES_BY_LANGUAGE[language]);
  }
}
