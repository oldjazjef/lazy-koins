import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AiGate } from '../../ai/application/ai-gate';
import {
  CalculateProjectCommand,
  CreateCorrectionCommand,
  GetChecksQuery,
  GetFigureRecordsQuery,
  GetResultQuery,
  ListCorrectionsQuery,
  SetCorrectionUndoneCommand,
  UpdateOpenItemCommand,
} from '../../calculation/application/calculation.handlers';
import { CalculationService } from '../../calculation/calculation.service';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import { ExportsService } from '../../exports/exports.service';
import {
  SetFileActiveCommand,
  SetFileActiveHandler,
} from '../../files/application/commands/set-file-active.command';
import { FileViews } from '../../files/application/file-views';
import {
  ListProjectFilesHandler,
  ListProjectFilesQuery,
} from '../../files/application/queries/list-project-files.query';
import { FilesService } from '../../files/files.service';
import { MailService } from '../../mail/mail.service';
import { GetMailSettingsQuery } from '../../mail/application/mail-settings.handlers';
import { MappingsService } from '../../mappings/mappings.service';
import { loadOwnProject } from '../../projects/application/project-access';
import {
  GetProjectHandler,
  GetProjectQuery,
} from '../../projects/application/queries/get-project.query';
import { ListMyProjectsQuery } from '../../projects/application/queries/list-my-projects.query';
import { ProjectsService } from '../../projects/projects.service';
import { GetRatesQuery } from '../../rates/application/rates.handlers';
import { RatesService } from '../../rates/rates.service';
import { GetSettingsQuery } from '../../settings/application/settings.handlers';
import { SettingsService } from '../../settings/settings.service';
import { WalletsService } from '../../wallets/wallets.service';
import {
  DeleteLibraryMappingCommand,
  DeleteLibraryMappingHandler,
  PublishLibraryMappingCommand,
  PublishLibraryMappingHandler,
  RateLibraryMappingCommand,
  RateLibraryMappingHandler,
  TakeLibraryMappingCommand,
  TakeLibraryMappingHandler,
} from '../../library/application/library.commands';
import {
  GetLibraryMappingHandler,
  GetLibraryMappingQuery,
  ReviewPublicationHandler,
  ReviewPublicationQuery,
  SearchLibraryHandler,
  SearchLibraryQuery,
} from '../../library/application/library.queries';
import { LibraryRuntime } from '../../library/application/library-runtime';
import { LibraryService } from '../../library/library.service';
import { InMemoryLibraryRepository } from '../../library/testing/in-memory-library.repository';
import { ToolExecutor } from '../application/tool-executor';
import { ToolRegistry } from '../application/tool-registry';
import type { ToolServices } from '../definitions/common';
import { InMemoryToolAuditRepository } from './in-memory-tool-audit.repository';

type Handler = { execute(message: never): Promise<unknown> };

/**
 * A CommandBus/QueryBus double: dispatches a message to the handler registered for its class —
 * so the tools run through the real service façades and handlers over port doubles.
 */
export class HandlerBus {
  private readonly handlers = new Map<unknown, Handler>();

  on(type: abstract new (...args: never[]) => unknown, handler: Handler): this {
    this.handlers.set(type, handler);
    return this;
  }

  execute(message: object): Promise<unknown> {
    const handler = this.handlers.get(message.constructor);
    if (!handler) {
      return Promise.reject(
        new Error(`HandlerBus: no handler for ${message.constructor.name}`),
      );
    }
    return handler.execute(message as never);
  }
}

/** Secrets the stubbed settings carry — a test asserts none reaches a tool's output. */
export const PLANTED_SECRETS = {
  coingeckoHint: '…K3Y9',
  aiCipher: 'enc:v1:planted-ai-key-cipher',
  aiHint: '…AIK9',
  mailHint: '…PW42',
} as const;

/**
 * The calculation fixture (a project with synthetic files) plus the tool layer over it: the real
 * façades and handlers for projects, files, results, checks and corrections; settings, mail and
 * the AI gate as stubs that carry planted secrets.
 */
export async function toolSetup() {
  const t = await calculationSetup();
  const views = new FileViews(t.projects, t.mappings, t.files);
  const bus = new HandlerBus()
    .on(GetProjectQuery, new GetProjectHandler(t.projects))
    .on(ListMyProjectsQuery, t.list)
    .on(
      ListProjectFilesQuery,
      new ListProjectFilesHandler(t.projects, t.files, views),
    )
    .on(SetFileActiveCommand, new SetFileActiveHandler(t.projects, t.files))
    .on(CalculateProjectCommand, t.calculate)
    .on(GetResultQuery, t.result)
    .on(GetFigureRecordsQuery, t.records)
    .on(GetChecksQuery, t.checks)
    .on(UpdateOpenItemCommand, t.tick)
    .on(ListCorrectionsQuery, t.listCorrections)
    .on(CreateCorrectionCommand, t.createCorrection)
    .on(SetCorrectionUndoneCommand, t.undo)
    .on(GetRatesQuery, {
      async execute(query: GetRatesQuery) {
        const project = await loadOwnProject(
          t.projects,
          query.userId,
          query.projectId,
        );
        const all = await t.rates.listByProject(project.id);
        return all.filter((r) => r.asset === query.asset?.toUpperCase());
      },
    })
    .on(GetSettingsQuery, {
      async execute() {
        return {
          displayName: 'Anna',
          canton: 'ZH',
          advisorName: 'Treuhand AG',
          advisorEmail: 'treuhand@example.ch',
          locale: 'de-CH',
          numberFormat: 'de-CH',
          dateFormat: 'dd.MM.yyyy',
          onlineRates: false,
          keys: { coingecko: PLANTED_SECRETS.coingeckoHint, etherscan: null },
          coingeckoIds: {},
          keyStorageAvailable: true,
        };
      },
    })
    .on(GetMailSettingsQuery, {
      async execute() {
        return {
          enabled: true,
          host: 'smtp.example.ch',
          port: 587,
          security: 'starttls',
          username: 'anna',
          hasPassword: true,
          passwordHint: PLANTED_SECRETS.mailHint,
          fromName: 'Anna',
          fromAddress: 'anna@example.ch',
          ready: true,
        };
      },
    });
  const commands = bus as unknown as CommandBus;
  const queries = bus as unknown as QueryBus;
  // F5.15–F5.17: the library over an in-memory repository (web: enabled).
  const library = new InMemoryLibraryRepository();
  const libraryRuntime = new LibraryRuntime(true);
  bus
    .on(SearchLibraryQuery, new SearchLibraryHandler(library, libraryRuntime))
    .on(
      GetLibraryMappingQuery,
      new GetLibraryMappingHandler(library, libraryRuntime),
    )
    .on(
      ReviewPublicationQuery,
      new ReviewPublicationHandler(library, t.mappings, libraryRuntime),
    )
    .on(
      PublishLibraryMappingCommand,
      new PublishLibraryMappingHandler(library, t.mappings, libraryRuntime),
    )
    .on(
      DeleteLibraryMappingCommand,
      new DeleteLibraryMappingHandler(library, libraryRuntime),
    )
    .on(
      RateLibraryMappingCommand,
      new RateLibraryMappingHandler(library, libraryRuntime),
    )
    .on(
      TakeLibraryMappingCommand,
      new TakeLibraryMappingHandler(
        library,
        t.mappings,
        t.projects,
        t.files,
        libraryRuntime,
        commands,
      ),
    );
  const files = new FilesService(commands, queries, views);
  const ai = {
    settingsOf: async (userId: string) => ({
      userId,
      enabled: true,
      provider: 'openai_compatible' as const,
      baseUrl: 'https://api.example.ch/v1',
      model: 'test-model',
      apiKeyCipher: PLANTED_SECRETS.aiCipher,
      apiKeyHint: PLANTED_SECRETS.aiHint,
      consentAt: null,
      updatedAt: null,
    }),
  } as unknown as AiGate;
  const services: ToolServices = {
    projects: new ProjectsService(commands, queries),
    files,
    mappings: new MappingsService(commands, queries, files),
    calculation: new CalculationService(commands, queries),
    rates: new RatesService(commands, queries),
    exports: new ExportsService(commands, queries),
    wallets: new WalletsService(commands, queries),
    settings: new SettingsService(commands, queries),
    mail: new MailService(commands, queries),
    ai,
    library: new LibraryService(commands, queries, libraryRuntime),
  };
  const audit = new InMemoryToolAuditRepository();
  const registry = ToolRegistry.over(services);
  const executor = new ToolExecutor(registry, audit);
  return { ...t, bus, services, audit, registry, executor, library };
}
