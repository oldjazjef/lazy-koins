import {
  type MailDelivery,
  type MailErrorDetail,
  MailTransportError,
  MailTransportPort,
  type OutgoingMail,
  type SmtpConnection,
} from '../../integrations/mail/mail-transport.port';
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
import {
  MailLogRepositoryPort,
  MailSettingsRepositoryPort,
  MailTemplateRepositoryPort,
} from '../ports/mail.repository.port';

/** A transport that records what it was given and never touches the network. */
export class FakeMailTransport extends MailTransportPort {
  readonly sent: { connection: SmtpConnection; mail: OutgoingMail }[] = [];
  /** Set to make the next sends fail with these details. */
  failWith: MailErrorDetail | null = null;

  async send(
    connection: SmtpConnection,
    mail: OutgoingMail,
  ): Promise<MailDelivery> {
    if (this.failWith) throw new MailTransportError(this.failWith);
    this.sent.push({ connection, mail });
    return {
      messageId: `<fake-${this.sent.length}@lazykoins.test>`,
      accepted: [...mail.to, ...mail.cc],
      rejected: [],
      response: '250 2.0.0 Ok: queued',
    };
  }
}

export class InMemoryMailSettingsRepository extends MailSettingsRepositoryPort {
  readonly rows = new Map<string, MailSettings>();

  async find(userId: string): Promise<MailSettings | undefined> {
    return this.rows.get(userId);
  }

  async save(
    userId: string,
    input: SaveMailSettingsInput,
  ): Promise<MailSettings> {
    const row: MailSettings = {
      userId,
      ...input,
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    this.rows.set(userId, row);
    return row;
  }
}

export class InMemoryMailTemplateRepository extends MailTemplateRepositoryPort {
  readonly rows = new Map<string, MailTemplate>();

  async find(
    userId: string,
    language: MailLanguage,
  ): Promise<MailTemplate | undefined> {
    return this.rows.get(`${userId}:${language}`);
  }

  async save(
    userId: string,
    language: MailLanguage,
    text: MailTemplateText,
  ): Promise<MailTemplate> {
    const row: MailTemplate = {
      language,
      ...text,
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    this.rows.set(`${userId}:${language}`, row);
    return row;
  }

  async remove(userId: string, language: MailLanguage): Promise<boolean> {
    return this.rows.delete(`${userId}:${language}`);
  }
}

export class InMemoryMailLogRepository extends MailLogRepositoryPort {
  readonly rows: MailLogEntry[] = [];

  async listByProject(projectId: string): Promise<MailLogEntry[]> {
    return this.rows.filter((row) => row.projectId === projectId).reverse();
  }

  async add(projectId: string, entry: NewMailLogEntry): Promise<MailLogEntry> {
    const row: MailLogEntry = {
      id: `m${this.rows.length + 1}`,
      projectId,
      ...entry,
      createdAt: new Date(
        Date.parse('2026-10-06T10:00:00.000Z') + this.rows.length * 1000,
      ).toISOString(),
    };
    this.rows.push(row);
    return row;
  }
}
