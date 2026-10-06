import { Logger } from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  type ImportResult,
  type MappingSample,
  mappingJsonSchema,
  validateMappingSpec,
} from '@lazykoins/engine';
import { ChangeProjectFileCommand } from '../../files/application/commands/change-project-file.command';
import {
  assertOpen,
  loadOwnProjectFile,
  orUnreadable,
} from '../../files/application/file-access';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import type { MappingPreview } from '../../files/application/queries/preview-mapping.query';
import type { ReadableFile } from '../../files/application/source-file-reader';
import type { ProjectFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import {
  AiCompletionPort,
  type AiConnection,
  type AiMessage,
  type AiUsage,
} from '../../integrations/ai/ai-completion.port';
import { specOr400 } from '../../mappings/application/mapping-access';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  type CandidateQuality,
  judge,
  repairMessage,
  type SpecIssue,
} from '../domain/mapping-candidate';
import { MAPPING_SYSTEM_PROMPT, mappingUserMessage } from '../domain/prompts';
import { AiGate } from './ai-gate';
import { AiSources } from './ai-sources';

/** Records and errors returned for the review table; the counts cover the whole file. */
const PREVIEW_LIMIT = 50;

export interface AiRequestPreview<T> {
  /** Exactly what is sent as the user message's data (F5.14). */
  readonly payload: T;
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
  /** False until the user agreed once; the app then asks for it with the payload. */
  readonly consentGiven: boolean;
}

export class GetMappingPayloadQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
  ) {}
}

/** F5.14: what would be sent to write a mapping for this file — nothing is sent. */
@QueryHandler(GetMappingPayloadQuery)
export class GetMappingPayloadHandler implements IQueryHandler<
  GetMappingPayloadQuery,
  AiRequestPreview<MappingSample>
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
  }: GetMappingPayloadQuery): Promise<AiRequestPreview<MappingSample>> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    const settings = await this.gate.settingsOf(userId);
    this.gate.connectionOf(settings);
    const { sample } = await this.sources.mappingSample(file);
    return {
      payload: sample,
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      consentGiven: settings.consentAt !== null,
    };
  }
}

export class GenerateMappingCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    /** The user ticked "send" in the consent dialog (required the first time). */
    readonly consent: boolean,
  ) {}
}

/** An AI proposal — never saved here; the user reviews, edits and saves it. */
export interface MappingCandidate {
  /** The spec as the model wrote it (the editor's starting point), valid or not. */
  readonly spec: unknown;
  readonly valid: boolean;
  readonly issues: readonly SpecIssue[];
  /** Dry run on the whole file; `null` while the spec is invalid. */
  readonly preview: MappingPreview | null;
  readonly kindCounts: Readonly<Record<string, number>>;
  readonly unknownValues: readonly { value: string; count: number }[];
  /** What still looks wrong after the last round (`rowErrors`, `unknownKinds`, …). */
  readonly problems: readonly string[];
  readonly rounds: number;
  readonly model: string;
  readonly usage: AiUsage | null;
}

interface Attempt {
  readonly raw: unknown;
  readonly text: string;
  readonly issues: readonly SpecIssue[];
  readonly result?: ImportResult;
  readonly quality?: CandidateQuality;
}

/**
 * F5.13: the AI writes the **mapping**, not the bookings. Sample → model → zod validation →
 * dry run of `applyMapping` on the full file → if the schema fails or many rows fail / stay
 * `unknown`, ONE repair round with the concrete problems → the candidate with its preview.
 */
@CommandHandler(GenerateMappingCommand)
export class GenerateMappingHandler implements ICommandHandler<
  GenerateMappingCommand,
  MappingCandidate
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly gate: AiGate,
    private readonly sources: AiSources,
    private readonly analysis: FileAnalysisService,
    private readonly ai: AiCompletionPort,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
    consent,
  }: GenerateMappingCommand): Promise<MappingCandidate> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    const { sample, readable } = await this.sources.mappingSample(file);
    const connection = await this.gate.connect(userId, consent);
    return new MappingWriter(this.gate, this.analysis, this.ai).write(
      connection,
      sample,
      readable,
      `file ${file.id}`,
    );
  }
}

/**
 * The AI round trip shared by a project file and the editor's sample file: sample → model → zod
 * validation → dry run of `applyMapping` on the whole file → at most one repair round.
 */
export class MappingWriter {
  private readonly logger = new Logger(MappingWriter.name);

  constructor(
    private readonly gate: AiGate,
    private readonly analysis: FileAnalysisService,
    private readonly ai: AiCompletionPort,
  ) {}

  async write(
    connection: AiConnection,
    sample: MappingSample,
    readable: ReadableFile,
    /** For the log line only — an id, never a file name or content. */
    label: string,
  ): Promise<MappingCandidate> {
    const messages: AiMessage[] = [
      { role: 'user', content: mappingUserMessage(JSON.stringify(sample)) },
    ];
    const usage = { inputTokens: 0, outputTokens: 0, reported: false };
    let model = connection.model;

    const ask = async (): Promise<Attempt> => {
      const answer = await this.complete(connection, messages);
      model = answer.model;
      if (answer.usage) {
        usage.inputTokens += answer.usage.inputTokens;
        usage.outputTokens += answer.usage.outputTokens;
        usage.reported = true;
      }
      return this.evaluate(answer.json, answer.text, readable);
    };

    let attempt = await ask();
    let rounds = 1;
    if (needsRepair(attempt)) {
      messages.push(
        { role: 'assistant', content: attempt.text },
        {
          role: 'user',
          content: repairMessage(
            sample,
            attempt.issues,
            attempt.result,
            attempt.quality,
          ),
        },
      );
      const repaired = await ask();
      rounds = 2;
      if (score(repaired) <= score(attempt)) attempt = repaired;
    }

    this.logger.log(
      `AI mapping for ${label}: ${rounds} round(s), valid=${attempt.issues.length === 0}, ` +
        `${attempt.quality?.records ?? 0} records, ${attempt.quality?.errors ?? 0} row errors, ` +
        `${usage.reported ? `${usage.inputTokens}+${usage.outputTokens} tokens` : 'no usage reported'}`,
    );
    return candidateOf(attempt, rounds, model, usage);
  }

  private complete(connection: AiConnection, messages: readonly AiMessage[]) {
    return this.gate.call(
      () =>
        this.ai.complete(connection, {
          system: MAPPING_SYSTEM_PROMPT,
          messages,
          output: {
            name: 'mapping_spec',
            description: 'A lazy-koins mapping spec v1 for the sampled export.',
            schema: mappingJsonSchema(),
          },
        }),
      connection,
    );
  }

  private async evaluate(
    raw: unknown,
    text: string,
    readable: ReadableFile,
  ): Promise<Attempt> {
    const validation = validateMappingSpec(raw);
    if (!validation.ok) return { raw, text, issues: validation.issues };
    const result = await orUnreadable(() =>
      this.analysis.apply(readable, validation.spec),
    );
    return { raw, text, issues: [], result, quality: judge(result) };
  }
}

function needsRepair(attempt: Attempt): boolean {
  return (
    attempt.issues.length > 0 || (attempt.quality?.problems.length ?? 0) > 0
  );
}

/** Lower is better: invalid specs worst, then by problems, row errors and unknown kinds. */
function score(attempt: Attempt): number {
  if (!attempt.quality) return Number.MAX_SAFE_INTEGER;
  return (
    attempt.quality.problems.length * 1_000_000 +
    attempt.quality.errors * 10 +
    attempt.quality.unknown
  );
}

function candidateOf(
  attempt: Attempt,
  rounds: number,
  model: string,
  usage: { inputTokens: number; outputTokens: number; reported: boolean },
): MappingCandidate {
  const result = attempt.result;
  return {
    spec: attempt.raw,
    valid: attempt.issues.length === 0,
    issues: attempt.issues,
    preview: result
      ? {
          result: {
            bookings: result.bookings.slice(0, PREVIEW_LIMIT),
            holdings: result.holdings.slice(0, PREVIEW_LIMIT),
            errors: result.errors.slice(0, PREVIEW_LIMIT),
            notes: result.notes.slice(0, PREVIEW_LIMIT),
            period: result.period,
          },
          totals: {
            bookings: result.bookings.length,
            holdings: result.holdings.length,
            errors: result.errors.length,
            notes: result.notes.length,
          },
        }
      : null,
    kindCounts: attempt.quality?.kindCounts ?? {},
    unknownValues: attempt.quality?.unknownValues ?? [],
    problems:
      attempt.quality?.problems ??
      (attempt.issues.length > 0 ? ['invalidSpec'] : []),
    rounds,
    model,
    usage: usage.reported
      ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
      : null,
  };
}

export class GetSampleMappingPayloadQuery {
  constructor(
    readonly userId: string,
    /** The mapping editor's sample file — not stored anywhere. */
    readonly file: ReadableFile,
  ) {}
}

/** F5.14 for the editor's sample file: what would be sent — nothing is sent, nothing stored. */
@QueryHandler(GetSampleMappingPayloadQuery)
export class GetSampleMappingPayloadHandler implements IQueryHandler<
  GetSampleMappingPayloadQuery,
  AiRequestPreview<MappingSample>
> {
  constructor(
    private readonly gate: AiGate,
    private readonly sources: AiSources,
  ) {}

  async execute({
    userId,
    file,
  }: GetSampleMappingPayloadQuery): Promise<AiRequestPreview<MappingSample>> {
    const settings = await this.gate.settingsOf(userId);
    this.gate.connectionOf(settings);
    return {
      payload: await this.sources.sampleOf(file),
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      consentGiven: settings.consentAt !== null,
    };
  }
}

export class GenerateSampleMappingCommand {
  constructor(
    readonly userId: string,
    readonly file: ReadableFile,
    readonly consent: boolean,
  ) {}
}

/**
 * "Mit AI erstellen" from the editor's sample file: the same round trip as for a project file;
 * the candidate goes back into the editor. Nothing is saved — not the file, not the spec.
 */
@CommandHandler(GenerateSampleMappingCommand)
export class GenerateSampleMappingHandler implements ICommandHandler<
  GenerateSampleMappingCommand,
  MappingCandidate
> {
  constructor(
    private readonly gate: AiGate,
    private readonly sources: AiSources,
    private readonly analysis: FileAnalysisService,
    private readonly ai: AiCompletionPort,
  ) {}

  async execute({
    userId,
    file,
    consent,
  }: GenerateSampleMappingCommand): Promise<MappingCandidate> {
    const sample = await this.sources.sampleOf(file);
    const connection = await this.gate.connect(userId, consent);
    return new MappingWriter(this.gate, this.analysis, this.ai).write(
      connection,
      sample,
      file,
      `sample ${file.sha256.slice(0, 12)}`,
    );
  }
}
export class AcceptSampleMappingCommand {
  constructor(
    readonly userId: string,
    /** The reviewed (possibly edited) spec the AI wrote from a sample file. */
    readonly spec: unknown,
  ) {}
}

/**
 * Saves a mapping the AI wrote from the editor's sample file (origin `ai`, F5.12). No file is
 * read here: the sample was never stored; adding it to a project is the normal upload.
 */
@CommandHandler(AcceptSampleMappingCommand)
export class AcceptSampleMappingHandler implements ICommandHandler<
  AcceptSampleMappingCommand,
  ImportMapping
> {
  constructor(private readonly mappings: ImportMappingRepositoryPort) {}

  async execute({
    userId,
    spec,
  }: AcceptSampleMappingCommand): Promise<ImportMapping> {
    return this.mappings.create(userId, {
      spec: specOr400(spec),
      origin: 'ai',
    });
  }
}
export class AcceptAiMappingCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    /** The reviewed (possibly edited) spec. */
    readonly spec: unknown,
  ) {}
}

/**
 * The user confirmed the reviewed spec: stored as an `import_mapping` with origin `ai` and the
 * file read with it. Later files with the same fingerprint are read with it on upload — no AI.
 */
@CommandHandler(AcceptAiMappingCommand)
export class AcceptAiMappingHandler implements ICommandHandler<
  AcceptAiMappingCommand,
  { mapping: ImportMapping; file: ProjectFile }
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly commands: CommandBus,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
    spec,
  }: AcceptAiMappingCommand): Promise<{
    mapping: ImportMapping;
    file: ProjectFile;
  }> {
    const { project, file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    assertOpen(project);
    const mapping = await this.mappings.create(userId, {
      spec: specOr400(spec),
      origin: 'ai',
    });
    const updated: ProjectFile = await this.commands.execute(
      new ChangeProjectFileCommand(userId, projectId, file.id, {
        mode: 'mapping',
        mappingId: mapping.id,
      }),
    );
    return { mapping, file: updated };
  }
}
