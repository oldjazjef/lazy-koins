import type { MailLogEntry, NewMailLogEntry } from '../domain/mail-log';
import type {
  MailSettings,
  SaveMailSettingsInput,
} from '../domain/mail-settings';
import type {
  MailLanguage,
  MailTemplate,
  MailTemplateText,
} from '../domain/mail-template';

/** Persistence contract for the per-user mailer (`mail_settings`, one row per user). */
export abstract class MailSettingsRepositoryPort {
  /** `undefined` when the user never saved any. */
  abstract find(userId: string): Promise<MailSettings | undefined>;

  /** Creates or replaces the user's row. */
  abstract save(
    userId: string,
    input: SaveMailSettingsInput,
  ): Promise<MailSettings>;
}

/** The user's own templates (`mail_template`, one row per user and language). */
export abstract class MailTemplateRepositoryPort {
  /** `undefined` = no own template: the default applies. */
  abstract find(
    userId: string,
    language: MailLanguage,
  ): Promise<MailTemplate | undefined>;

  abstract save(
    userId: string,
    language: MailLanguage,
    text: MailTemplateText,
  ): Promise<MailTemplate>;

  /** "auf Standard zurücksetzen"; `false` when there was nothing stored. */
  abstract remove(userId: string, language: MailLanguage): Promise<boolean>;
}

/** The send log per project (`mail_log`). */
export abstract class MailLogRepositoryPort {
  /** Newest first. */
  abstract listByProject(projectId: string): Promise<MailLogEntry[]>;

  abstract add(
    projectId: string,
    entry: NewMailLogEntry,
  ): Promise<MailLogEntry>;
}
