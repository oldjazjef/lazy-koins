import { Injectable } from '@nestjs/common';
import type {
  MailLog as MailLogRow,
  MailSettings as MailSettingsRow,
  MailTemplate as MailTemplateRow,
} from '../../../generated/prisma/client';
import type { MailSecurity } from '../../../integrations/mail/mail-transport.port';
import type {
  MailLogAttachment,
  MailLogEntry,
  MailLogStatus,
  NewMailLogEntry,
} from '../../../mail/domain/mail-log';
import type {
  MailSettings,
  SaveMailSettingsInput,
} from '../../../mail/domain/mail-settings';
import type {
  MailLanguage,
  MailTemplate,
  MailTemplateText,
} from '../../../mail/domain/mail-template';
import {
  MailLogRepositoryPort,
  MailSettingsRepositoryPort,
  MailTemplateRepositoryPort,
} from '../../../mail/ports/mail.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toSettings(row: MailSettingsRow): MailSettings {
  return {
    userId: row.userId,
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    security: row.security as MailSecurity,
    username: row.username,
    passwordCipher: row.passwordCipher,
    passwordHint: row.passwordHint,
    fromName: row.fromName,
    fromAddress: row.fromAddress,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class MailSettingsPrismaRepository extends MailSettingsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(userId: string): Promise<MailSettings | undefined> {
    const row = await this.prisma.mailSettings.findUnique({
      where: { userId },
    });
    return row ? toSettings(row) : undefined;
  }

  async save(
    userId: string,
    input: SaveMailSettingsInput,
  ): Promise<MailSettings> {
    const data = {
      enabled: input.enabled,
      host: input.host,
      port: input.port,
      security: input.security,
      username: input.username,
      passwordCipher: input.passwordCipher,
      passwordHint: input.passwordHint,
      fromName: input.fromName,
      fromAddress: input.fromAddress,
    };
    const row = await this.prisma.mailSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toSettings(row);
  }
}

function toTemplate(row: MailTemplateRow): MailTemplate {
  return {
    language: row.language as MailLanguage,
    subject: row.subject,
    body: row.body,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class MailTemplatePrismaRepository extends MailTemplateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(
    userId: string,
    language: MailLanguage,
  ): Promise<MailTemplate | undefined> {
    const row = await this.prisma.mailTemplate.findUnique({
      where: { userId_language: { userId, language } },
    });
    return row ? toTemplate(row) : undefined;
  }

  async save(
    userId: string,
    language: MailLanguage,
    text: MailTemplateText,
  ): Promise<MailTemplate> {
    const data = { subject: text.subject, body: text.body };
    const row = await this.prisma.mailTemplate.upsert({
      where: { userId_language: { userId, language } },
      create: { userId, language, ...data },
      update: data,
    });
    return toTemplate(row);
  }

  async remove(userId: string, language: MailLanguage): Promise<boolean> {
    const { count } = await this.prisma.mailTemplate.deleteMany({
      where: { userId, language },
    });
    return count > 0;
  }
}

function toEntry(row: MailLogRow): MailLogEntry {
  const attachments: unknown = JSON.parse(row.attachments);
  return {
    id: row.id,
    projectId: row.projectId,
    to: row.toAddress,
    cc: row.ccAddress,
    subject: row.subject,
    attachments: Array.isArray(attachments)
      ? (attachments as MailLogAttachment[])
      : [],
    status: row.status as MailLogStatus,
    error: row.error,
    messageId: row.messageId,
    createdAt: toIsoString(row.createdAt),
  };
}

@Injectable()
export class MailLogPrismaRepository extends MailLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByProject(projectId: string): Promise<MailLogEntry[]> {
    const rows = await this.prisma.mailLog.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toEntry);
  }

  async add(projectId: string, entry: NewMailLogEntry): Promise<MailLogEntry> {
    const row = await this.prisma.mailLog.create({
      data: {
        projectId,
        toAddress: entry.to,
        ccAddress: entry.cc,
        subject: entry.subject,
        attachments: JSON.stringify(entry.attachments),
        status: entry.status,
        error: entry.error,
        messageId: entry.messageId,
      },
    });
    return toEntry(row);
  }
}
