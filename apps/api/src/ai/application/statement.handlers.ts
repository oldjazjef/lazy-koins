import {
  BadRequestException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { AddDerivedFileCommand } from '../../files/application/commands/add-derived-file.command';
import {
  assertOpen,
  loadOwnProjectFile,
} from '../../files/application/file-access';
import type { ProjectFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import {
  AiCompletionPort,
  type AiMessage,
  type AiUsage,
} from '../../integrations/ai/ai-completion.port';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  STATEMENT_SYSTEM_PROMPT,
  statementUserMessage,
} from '../domain/prompts';
import {
  derivedFileName,
  type ExtractedHolding,
  holdingsCsv,
  reviewHoldings,
  type StatementExtraction,
  StatementExtractionSchema,
  statementJsonSchema,
  type StatementPayload,
} from '../domain/statement-extraction';
import { AiGate } from './ai-gate';
import { AiSources } from './ai-sources';
import type { AiRequestPreview } from './mapping.handlers';

export class GetStatementPayloadQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
  ) {}
}

/** F5.14: the page texts that would be sent to read a PDF statement — nothing is sent. */
@QueryHandler(GetStatementPayloadQuery)
export class GetStatementPayloadHandler implements IQueryHandler<
  GetStatementPayloadQuery,
  AiRequestPreview<StatementPayload>
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly gate: AiGate,
    private readonly sources: AiSources,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
  }: GetStatementPayloadQuery): Promise<AiRequestPreview<StatementPayload>> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    const settings = await this.gate.settingsOf(userId);
    this.gate.connectionOf(settings);
    const { payload } = await this.sources.statement(file);
    return {
      payload,
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      consentGiven: settings.consentAt !== null,
    };
  }
}

export class ExtractStatementCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    readonly consent: boolean,
  ) {}
}

export interface StatementCandidate {
  readonly holdings: readonly ExtractedHolding[];
  /** Only part of the PDF was sent (page/character limit). */
  readonly truncated: boolean;
  readonly rounds: number;
  readonly model: string;
  readonly usage: AiUsage | null;
}

/**
 * PDF statement → Bestände proposal (one-off, no mapping): page texts → model (JSON Schema) →
 * zod; an invalid answer gets ONE repair round → every quantity normalised textually and checked
 * verbatim against the text. Nothing is stored here.
 */
@CommandHandler(ExtractStatementCommand)
export class ExtractStatementHandler implements ICommandHandler<
  ExtractStatementCommand,
  StatementCandidate
> {
  private readonly logger = new Logger(ExtractStatementHandler.name);

  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly gate: AiGate,
    private readonly sources: AiSources,
    private readonly ai: AiCompletionPort,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
    consent,
  }: ExtractStatementCommand): Promise<StatementCandidate> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    const { payload, pages } = await this.sources.statement(file);
    const connection = await this.gate.connect(userId, consent);
    const messages: AiMessage[] = [
      { role: 'user', content: statementUserMessage(JSON.stringify(payload)) },
    ];
    const usage = { inputTokens: 0, outputTokens: 0, reported: false };
    let model = connection.model;
    let rounds = 0;
    let extraction: StatementExtraction | undefined;
    while (rounds < 2 && !extraction) {
      rounds += 1;
      const answer = await this.gate.call(() =>
        this.ai.complete(connection, {
          system: STATEMENT_SYSTEM_PROMPT,
          messages,
          output: {
            name: 'statement_holdings',
            description: 'Balances per asset printed in the statement.',
            schema: statementJsonSchema(),
          },
        }),
      );
      model = answer.model;
      if (answer.usage) {
        usage.inputTokens += answer.usage.inputTokens;
        usage.outputTokens += answer.usage.outputTokens;
        usage.reported = true;
      }
      const parsed = StatementExtractionSchema.safeParse(answer.json);
      if (parsed.success) {
        extraction = parsed.data;
      } else {
        messages.push(
          { role: 'assistant', content: answer.text },
          {
            role: 'user',
            content: `Your answer does not match the schema. Fix these errors and answer again with the complete JSON:\n${parsed.error.issues
              .slice(0, 30)
              .map((i) => `- ${i.path.join('.') || '/'}: ${i.message}`)
              .join('\n')}`,
          },
        );
      }
    }
    if (!extraction) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'The AI answer did not match the expected format',
        code: 'invalidAnswer',
      });
    }
    const holdings = reviewHoldings(extraction, pages);
    this.logger.log(
      `AI statement for file ${file.id}: ${rounds} round(s), ${holdings.length} balances, ` +
        `${holdings.filter((h) => !h.verbatim).length} not verbatim`,
    );
    return {
      holdings,
      truncated: payload.truncated,
      rounds,
      model,
      usage: usage.reported
        ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
        : null,
    };
  }
}

export class AcceptStatementCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    /** The records the user kept, as the AI returned them (printed strings, page). */
    readonly holdings: StatementExtraction['holdings'],
  ) {}
}

/**
 * Stores the confirmed balances as a **derived standard-format CSV** (origin
 * `derived_from:<pdf>`); the PDF stays as evidence. The server normalises and checks the printed
 * quantities again against the PDF's text — the client cannot change a number.
 */
@CommandHandler(AcceptStatementCommand)
export class AcceptStatementHandler implements ICommandHandler<
  AcceptStatementCommand,
  ProjectFile
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly sources: AiSources,
    private readonly commands: CommandBus,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
    holdings,
  }: AcceptStatementCommand): Promise<ProjectFile> {
    const { project, file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    assertOpen(project);
    const parsed = StatementExtractionSchema.safeParse({ holdings });
    if (!parsed.success || parsed.data.holdings.length === 0) {
      throw new BadRequestException(
        'Send at least one balance as returned by the extraction',
      );
    }
    const { pages } = await this.sources.statement(file);
    const reviewed = reviewHoldings(parsed.data, pages);
    const csv = holdingsCsv(file.displayName, reviewed);
    if (!csv.ok) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Some balances are not valid standard-format records',
        errors: csv.errors,
      });
    }
    return this.commands.execute(
      new AddDerivedFileCommand(
        userId,
        projectId,
        file.id,
        derivedFileName(file.displayName),
        new TextEncoder().encode(csv.csv),
      ),
    );
  }
}
