import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  CreateExportCommand,
  GetExportContentQuery,
  GetMailDraftQuery,
  ListExportsQuery,
} from './application/exports.handlers';
import type { MailDraft } from './application/mail-draft';
import type {
  ExportKind,
  ProjectExportContent,
  ProjectExportMeta,
} from './domain/project-export';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class ExportsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  create(
    userId: string,
    projectId: string,
    kind: ExportKind,
  ): Promise<ProjectExportMeta> {
    return this.commands.execute(
      new CreateExportCommand(userId, projectId, kind),
    );
  }

  list(userId: string, projectId: string): Promise<ProjectExportMeta[]> {
    return this.queries.execute(new ListExportsQuery(userId, projectId));
  }

  content(
    userId: string,
    projectId: string,
    exportId: string,
  ): Promise<ProjectExportContent> {
    return this.queries.execute(
      new GetExportContentQuery(userId, projectId, exportId),
    );
  }

  mailDraft(userId: string, projectId: string): Promise<MailDraft> {
    return this.queries.execute(new GetMailDraftQuery(userId, projectId));
  }
}
