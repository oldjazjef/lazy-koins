import { BadRequestException } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { ProjectExportRepositoryPort } from '../../exports/ports/project-export.repository.port';
import {
  type ChangeReason,
  changesSinceSent,
  manualSentAt,
  NO_CHANGES,
  type ProjectSentState,
  type SentVia,
} from '../domain/project-sent';
import { ProjectRepositoryPort } from '../ports/project.repository.port';
import { ProjectSentRepositoryPort } from '../ports/project-sent.repository.port';
import { loadOwnProject } from './project-access';

/** F4.7 as the app sees it: the state, and why it is "seit dem Versand geändert". */
export interface ProjectSentView {
  readonly sent: Omit<ProjectSentState, 'projectId' | 'updatedAt'> | null;
  /** Empty = nothing changed since it was sent (or never sent). */
  readonly changes: ChangeReason[];
}

/** The view of one project's sent state (shared by the handlers here and the mail slice). */
export async function projectSentView(
  sent: ProjectSentRepositoryPort,
  projectId: string,
): Promise<ProjectSentView> {
  const state = await sent.find(projectId);
  if (!state) return { sent: null, changes: [] };
  const facts =
    (await sent.changeFacts([projectId])).get(projectId) ?? NO_CHANGES;
  const { projectId: _id, updatedAt: _at, ...rest } = state;
  return { sent: rest, changes: changesSinceSent(state, facts) };
}

export class GetProjectSentQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(GetProjectSentQuery)
export class GetProjectSentHandler implements IQueryHandler<
  GetProjectSentQuery,
  ProjectSentView
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly sent: ProjectSentRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: GetProjectSentQuery): Promise<ProjectSentView> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    return projectSentView(this.sent, project.id);
  }
}

export interface MarkProjectSentInput {
  /** YYYY-MM-DD, not in the future. */
  readonly date: string;
  readonly via: SentVia;
  readonly note: string;
  readonly to: string;
  /** Which statements went out; ids of other projects are ignored. */
  readonly exportIds: readonly string[];
}

export class MarkProjectSentCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly input: MarkProjectSentInput,
    readonly now: Date = new Date(),
  ) {}
}

/**
 * F4.7 by hand ("als gesendet markieren": date, way, note). Allowed on a closed project, like the
 * exports: sending the final statement is what happens after closing it.
 */
@CommandHandler(MarkProjectSentCommand)
export class MarkProjectSentHandler implements ICommandHandler<
  MarkProjectSentCommand,
  ProjectSentView
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly sent: ProjectSentRepositoryPort,
    private readonly exports: ProjectExportRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    input,
    now,
  }: MarkProjectSentCommand): Promise<ProjectSentView> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      Number.isNaN(Date.parse(input.date))
    ) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    if (input.date > now.toISOString().slice(0, 10)) {
      throw new BadRequestException('date must not be in the future');
    }
    const own = new Set(
      (await this.exports.listByProject(project.id)).map((item) => item.id),
    );
    const facts =
      (await this.sent.changeFacts([project.id])).get(project.id) ?? NO_CHANGES;
    await this.sent.save(project.id, {
      sentAt: manualSentAt(input.date, now),
      sentTo: input.to.trim(),
      via: input.via,
      note: input.note.trim(),
      exportIds: [...new Set(input.exportIds)].filter((id) => own.has(id)),
      mailLogId: null,
      snapshotHash: facts.latestSnapshot?.inputHash ?? null,
    });
    return projectSentView(this.sent, project.id);
  }
}

export class UndoProjectSentCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** F4.7 "rückgängig": the project is "not sent" again; the mail log stays. */
@CommandHandler(UndoProjectSentCommand)
export class UndoProjectSentHandler implements ICommandHandler<
  UndoProjectSentCommand,
  ProjectSentView
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly sent: ProjectSentRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: UndoProjectSentCommand): Promise<ProjectSentView> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    await this.sent.remove(project.id);
    return { sent: null, changes: [] };
  }
}
