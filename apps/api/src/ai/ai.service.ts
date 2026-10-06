import type { AiConnectionDraft } from './application/ai-gate';
import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  FileViews,
  type ProjectFileView,
} from '../files/application/file-views';
import type { ProjectFile } from '../files/domain/project-file';
import type { ImportMapping } from '../mappings/domain/import-mapping';
import {
  AcceptAiMappingCommand,
  type AiRequestPreview,
  GenerateMappingCommand,
  GetMappingPayloadQuery,
  type MappingCandidate,
} from './application/mapping.handlers';
import {
  type AiConnectionTest,
  type AiSettingsView,
  GetAiSettingsQuery,
  SaveAiSettingsCommand,
  type SaveAiSettingsInput,
  TestAiConnectionCommand,
} from './application/settings.handlers';
import {
  AcceptStatementCommand,
  ExtractStatementCommand,
  GetStatementPayloadQuery,
  type StatementCandidate,
} from './application/statement.handlers';
import type { MappingSample } from './domain/mapping-sample';
import type {
  StatementExtraction,
  StatementPayload,
} from './domain/statement-extraction';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class AiService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly views: FileViews,
  ) {}

  settings(userId: string): Promise<AiSettingsView> {
    return this.queries.execute(new GetAiSettingsQuery(userId));
  }

  saveSettings(
    userId: string,
    input: SaveAiSettingsInput,
  ): Promise<AiSettingsView> {
    return this.commands.execute(new SaveAiSettingsCommand(userId, input));
  }

  testConnection(
    userId: string,
    draft?: AiConnectionDraft,
  ): Promise<AiConnectionTest> {
    return this.commands.execute(new TestAiConnectionCommand(userId, draft));
  }

  mappingPayload(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<AiRequestPreview<MappingSample>> {
    return this.queries.execute(
      new GetMappingPayloadQuery(userId, projectId, fileId),
    );
  }

  generateMapping(
    userId: string,
    projectId: string,
    fileId: string,
    consent: boolean,
  ): Promise<MappingCandidate> {
    return this.commands.execute(
      new GenerateMappingCommand(userId, projectId, fileId, consent),
    );
  }

  async acceptMapping(
    userId: string,
    projectId: string,
    fileId: string,
    spec: unknown,
  ): Promise<{ mapping: ImportMapping; file: ProjectFileView }> {
    const { mapping, file } = (await this.commands.execute(
      new AcceptAiMappingCommand(userId, projectId, fileId, spec),
    )) as { mapping: ImportMapping; file: ProjectFile };
    return { mapping, file: await this.views.one(userId, file) };
  }

  statementPayload(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<AiRequestPreview<StatementPayload>> {
    return this.queries.execute(
      new GetStatementPayloadQuery(userId, projectId, fileId),
    );
  }

  extractStatement(
    userId: string,
    projectId: string,
    fileId: string,
    consent: boolean,
  ): Promise<StatementCandidate> {
    return this.commands.execute(
      new ExtractStatementCommand(userId, projectId, fileId, consent),
    );
  }

  async acceptStatement(
    userId: string,
    projectId: string,
    fileId: string,
    holdings: StatementExtraction['holdings'],
  ): Promise<ProjectFileView> {
    const file: ProjectFile = await this.commands.execute(
      new AcceptStatementCommand(userId, projectId, fileId, holdings),
    );
    return this.views.one(userId, file);
  }
}
