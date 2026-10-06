import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CreateProjectCommand } from './application/commands/create-project.command';
import { DeleteProjectCommand } from './application/commands/delete-project.command';
import { UpdateProjectCommand } from './application/commands/update-project.command';
import { GetProjectQuery } from './application/queries/get-project.query';
import {
  ListMyProjectsQuery,
  type ProjectListEntry,
} from './application/queries/list-my-projects.query';
import {
  GetProjectSentQuery,
  MarkProjectSentCommand,
  type MarkProjectSentInput,
  type ProjectSentView,
  UndoProjectSentCommand,
} from './application/sent.handlers';
import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from './domain/project';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  listMine(userId: string): Promise<ProjectListEntry[]> {
    return this.queries.execute(new ListMyProjectsQuery(userId));
  }

  get(userId: string, projectId: string): Promise<Project> {
    return this.queries.execute(new GetProjectQuery(userId, projectId));
  }

  create(userId: string, input: CreateProjectInput): Promise<Project> {
    return this.commands.execute(new CreateProjectCommand(userId, input));
  }

  update(
    userId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<Project> {
    return this.commands.execute(
      new UpdateProjectCommand(userId, projectId, input),
    );
  }

  remove(userId: string, projectId: string): Promise<void> {
    return this.commands.execute(new DeleteProjectCommand(userId, projectId));
  }

  sent(userId: string, projectId: string): Promise<ProjectSentView> {
    return this.queries.execute(new GetProjectSentQuery(userId, projectId));
  }

  markSent(
    userId: string,
    projectId: string,
    input: MarkProjectSentInput,
  ): Promise<ProjectSentView> {
    return this.commands.execute(
      new MarkProjectSentCommand(userId, projectId, input),
    );
  }

  undoSent(userId: string, projectId: string): Promise<ProjectSentView> {
    return this.commands.execute(new UndoProjectSentCommand(userId, projectId));
  }
}
