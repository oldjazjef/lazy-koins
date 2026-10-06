import { BadRequestException, Optional } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { CalculationSnapshotRepositoryPort } from '../../calculation/ports/calculation.repository.port';
import { ExportDataService } from '../../exports/application/exports.handlers';
import type {
  ProjectExportContent,
  ProjectExportMeta,
} from '../../exports/domain/project-export';
import { ProjectExportRepositoryPort } from '../../exports/ports/project-export.repository.port';
import { NotificationService } from '../../notifications/application/notification.service';
import { ProjectNotifications } from '../../notifications/application/project-notifications.service';
import { projectRoute, Topics } from '../../notifications/domain/notification';
import { loadOwnProject } from '../../projects/application/project-access';
import {
  projectSentView,
  type ProjectSentView,
} from '../../projects/application/sent.handlers';
import type { Project } from '../../projects/domain/project';
import { NO_CHANGES } from '../../projects/domain/project-sent';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { ProjectSentRepositoryPort } from '../../projects/ports/project-sent.repository.port';
import { SettingsReader } from '../../settings/application/settings.handlers';
import { UserRepositoryPort } from '../../users/ports/user.repository.port';
import {
  isInternalExportKind,
  MAX_ATTACHMENT_BYTES,
  type MailLogEntry,
} from '../domain/mail-log';
import { isMailAddress, mailReady, ownAddress } from '../domain/mail-settings';
import {
  BODY_MAX,
  type MailLanguage,
  plainTextValue,
  renderMail,
  SUBJECT_MAX,
} from '../domain/mail-template';
import { MailLogRepositoryPort } from '../ports/mail.repository.port';
import { MailGate, mailUnprocessable } from './mail-gate';
import { smtpFailure } from './mail-settings.handlers';
import { MailTemplates } from './mail-template.handlers';
import { mailValues } from './mail-values';

/** A stored statement offered as an attachment. */
export interface AttachmentOption {
  readonly id: string;
  readonly kind: string;
  readonly fileName: string;
  readonly size: number;
  readonly createdAt: string;
  /** Meant for the user, not the Treuhänder: never preselected, shown with a warning. */
  readonly internal: boolean;
  readonly selected: boolean;
}

/** What the "An Treuhänder senden" dialog opens with (F10.6a). */
export interface MailComposition {
  /** A mailer is set up and on — otherwise the dialog offers copy + `mailto:` only. */
  readonly mailerReady: boolean;
  readonly to: string;
  readonly advisorName: string;
  /** The address "CC an mich" uses. */
  readonly ownAddress: string;
  readonly subject: string;
  readonly body: string;
  readonly unknownPlaceholders: string[];
  readonly attachments: AttachmentOption[];
  readonly maxAttachmentBytes: number;
  /** False before the first calculation: the figures read `–`. */
  readonly calculated: boolean;
}

/** The latest statement of each non-internal kind — what the Treuhänder needs by default. */
export function preselectedExports(
  exports: readonly ProjectExportMeta[],
): Set<string> {
  const latest = new Map<string, string>();
  for (const item of exports) {
    if (!isInternalExportKind(item.kind) && !latest.has(item.kind)) {
      latest.set(item.kind, item.id);
    }
  }
  return new Set(latest.values());
}

export class ComposeMailQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    /** The attachments chosen in the dialog; absent = the preselection. */
    readonly exportIds?: readonly string[],
    readonly language: MailLanguage = 'de-CH',
    readonly now: Date = new Date(),
  ) {}
}

/**
 * F10.6a: the mail to the Treuhänder from the user's template (F11.10) and the project's latest
 * calculation (no recalculation, like the F10.6 draft), with the stored statements to choose
 * from. Rendered again when the attachment selection changes ({{anhaenge}}).
 */
@QueryHandler(ComposeMailQuery)
export class ComposeMailHandler implements IQueryHandler<
  ComposeMailQuery,
  MailComposition
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly exports: ProjectExportRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly data: ExportDataService,
    private readonly settings: SettingsReader,
    private readonly users: UserRepositoryPort,
    private readonly gate: MailGate,
    private readonly templates: MailTemplates,
  ) {}

  async execute(query: ComposeMailQuery): Promise<MailComposition> {
    const project = await loadOwnProject(
      this.projects,
      query.userId,
      query.projectId,
    );
    const exports = await this.exports.listByProject(project.id);
    const chosen = query.exportIds
      ? new Set(query.exportIds)
      : preselectedExports(exports);
    const attachments = exports.map((item) => ({
      id: item.id,
      kind: item.kind,
      fileName: item.fileName,
      size: item.size,
      createdAt: item.createdAt,
      internal: isInternalExportKind(item.kind),
      selected: chosen.has(item.id),
    }));
    const { values, advisorEmail, advisorName, calculated } =
      await this.valuesOf(
        query.userId,
        project,
        attachments.filter((a) => a.selected).map((a) => a.fileName),
        query.now,
      );
    const rendered = renderMail(
      await this.templates.of(query.userId, query.language),
      values,
    );
    const mailer = await this.gate.settingsOf(query.userId);
    const user = await this.users.findById(query.userId);
    return {
      mailerReady: mailReady(mailer),
      to: advisorEmail,
      advisorName,
      ownAddress: ownAddress(user?.email ?? '', mailer.fromAddress),
      subject: rendered.subject,
      body: rendered.body,
      unknownPlaceholders: rendered.unknownPlaceholders,
      attachments,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      calculated,
    };
  }

  private async valuesOf(
    userId: string,
    project: Project,
    attachmentNames: string[],
    now: Date,
  ) {
    const snapshot = await this.snapshots.latest(project.id);
    const settings = await this.settings.resolve(userId);
    const user = await this.users.findById(userId);
    const data = snapshot
      ? await this.data.build(userId, project, snapshot, snapshot.createdAt)
      : null;
    return {
      values: mailValues({
        project,
        data,
        ownerName: settings.displayName || user?.displayName || '',
        advisorName: settings.advisorName,
        attachmentNames,
        now,
      }),
      advisorEmail: settings.advisorEmail,
      advisorName: settings.advisorName,
      calculated: snapshot !== undefined,
    };
  }
}

export interface SendMailInput {
  readonly to: string;
  readonly ccMe: boolean;
  readonly subject: string;
  readonly body: string;
  readonly exportIds: readonly string[];
  /** The explicit confirmation step of the dialog; without it nothing is sent. */
  readonly confirmed: boolean;
}

export class SendMailCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly input: SendMailInput,
  ) {}
}

export interface SendMailResult {
  readonly log: MailLogEntry;
  readonly sent: ProjectSentView;
}

/**
 * F10.6a: sends the reviewed mail with the chosen statements through the user's mailer, logs it
 * (sent or failed — never a password, not the body) and on success marks the project as sent to
 * the Treuhänder (F4.7, via `mail`). Allowed on a closed project, like the exports.
 */
@CommandHandler(SendMailCommand)
export class SendMailHandler implements ICommandHandler<
  SendMailCommand,
  SendMailResult
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly exports: ProjectExportRepositoryPort,
    private readonly users: UserRepositoryPort,
    private readonly gate: MailGate,
    private readonly log: MailLogRepositoryPort,
    private readonly sent: ProjectSentRepositoryPort,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    input,
  }: SendMailCommand): Promise<SendMailResult> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    if (!input.confirmed) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Confirm sending first',
        code: 'confirmationRequired',
      });
    }
    const settings = await this.gate.settingsOf(userId);
    const mailer = this.gate.mailerOf(settings);

    const to = input.to.trim();
    if (!isMailAddress(to)) {
      throw mailUnprocessable(
        'invalidAddress',
        'The recipient is not an e-mail address',
      );
    }
    const subject = plainTextValue(input.subject, true).slice(0, SUBJECT_MAX);
    const body = plainTextValue(input.body, false);
    if (subject === '' || body.trim() === '' || body.length > BODY_MAX) {
      throw mailUnprocessable(
        'emptyMail',
        'Subject and text are required (text at most 20 000 characters)',
      );
    }
    const attachments = await this.attachmentsOf(project.id, input.exportIds);
    const user = await this.users.findById(userId);
    const cc = input.ccMe
      ? ownAddress(user?.email ?? '', settings.fromAddress)
      : null;

    const outcome = await this.gate.deliver(mailer, {
      from: mailer.from,
      to: [to],
      cc: cc && cc !== to ? [cc] : [],
      subject,
      text: body,
      attachments: attachments.map((item) => ({
        fileName: item.fileName,
        contentType: item.mediaType,
        content: item.bytes,
      })),
    });
    const logged = {
      to,
      cc,
      subject,
      attachments: attachments.map((item) => ({
        exportId: item.id,
        fileName: item.fileName,
        size: item.size,
      })),
    };
    if (!outcome.ok) {
      const { detail } = outcome;
      await this.log.add(project.id, {
        ...logged,
        status: 'failed',
        error: [
          detail.kind,
          detail.smtpCode ?? undefined,
          detail.response ?? undefined,
        ]
          .filter((part) => part !== undefined)
          .join(' – ')
          .slice(0, 500),
        messageId: null,
      });
      await this.notifyFailure(userId, project.id, detail.kind);
      throw smtpFailure(detail);
    }
    const entry = await this.log.add(project.id, {
      ...logged,
      status: 'sent',
      error: null,
      messageId: outcome.delivery.messageId || null,
    });
    const facts =
      (await this.sent.changeFacts([project.id])).get(project.id) ?? NO_CHANGES;
    await this.sent.save(project.id, {
      sentAt: entry.createdAt,
      sentTo: to,
      via: 'mail',
      note: '',
      exportIds: attachments.map((item) => item.id),
      mailLogId: entry.id,
      snapshotHash: facts.latestSnapshot?.inputHash ?? null,
    });
    await this.notifySent(userId, project.id, attachments.length);
    return { log: entry, sent: await projectSentView(this.sent, project.id) };
  }

  /** F11.12: "Mail-Versand fehlgeschlagen" (the kind, never the server's text); auth → key. */
  private async notifyFailure(
    userId: string,
    projectId: string,
    kind: string,
  ): Promise<void> {
    if (!this.notifications) return;
    await this.notifications.raise(userId, Topics.mailSendFailed(projectId), {
      kind: 'error',
      projectId,
      params: { reason: kind },
      action: projectRoute(projectId, 'notifications.action.retry', 'exports'),
    });
    if (kind === 'auth') {
      await this.notifications.raise(userId, Topics.keyInvalid('mail'), {
        kind: 'action',
        params: { service: 'Mail' },
        action: {
          labelKey: 'notifications.action.checkKey',
          route: '/app/settings/mail',
        },
      });
    }
  }

  /** "Mail gesendet" (success), the failure and the key problem are settled; F4.7 re-checked. */
  private async notifySent(
    userId: string,
    projectId: string,
    attachments: number,
  ): Promise<void> {
    if (this.notifications) {
      await this.notifications.resolve(userId, [
        Topics.mailSendFailed(projectId),
        Topics.keyInvalid('mail'),
      ]);
      await this.notifications.raise(userId, Topics.mailSent(projectId), {
        kind: 'success',
        projectId,
        params: { count: attachments },
        action: projectRoute(projectId, 'notifications.action.show', 'exports'),
      });
    }
    await this.projectNotifications?.sentChanged(userId, projectId);
  }

  /** The chosen statements of this project, at most 20 MB together. */
  private async attachmentsOf(
    projectId: string,
    ids: readonly string[],
  ): Promise<ProjectExportContent[]> {
    const out: ProjectExportContent[] = [];
    for (const id of new Set(ids)) {
      const content = await this.exports.findContent(id);
      if (!content || content.projectId !== projectId) {
        throw mailUnprocessable(
          'unknownExport',
          'An attachment is not a statement of this project',
        );
      }
      out.push(content);
    }
    const total = out.reduce((sum, item) => sum + item.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      throw mailUnprocessable(
        'attachmentsTooLarge',
        'The attachments are larger than 20 MB together',
        { totalBytes: total, maxBytes: MAX_ATTACHMENT_BYTES },
      );
    }
    return out;
  }
}

export class ListMailLogQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** F10.6a: the project's send log, newest first. */
@QueryHandler(ListMailLogQuery)
export class ListMailLogHandler implements IQueryHandler<
  ListMailLogQuery,
  MailLogEntry[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly log: MailLogRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListMailLogQuery): Promise<MailLogEntry[]> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    return this.log.listByProject(project.id);
  }
}
