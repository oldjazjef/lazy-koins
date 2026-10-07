import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  GetStandardMappingQuery,
  ListStandardMappingsQuery,
  ProjectMappingSuggestionsQuery,
  type StandardMappingView,
  type SuggestionPreview,
  SuggestionPreviewQuery,
  type TakenStandardMapping,
  TakeStandardMappingCommand,
} from './application/suggestions.handlers';
import type { ProjectSuggestions, SuggestionSource } from './domain/suggestion';

/** Thin façade over the buses (F5.19): the standard catalogue and the upload suggestions. */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  listStandard(userId: string): Promise<StandardMappingView[]> {
    return this.queries.execute(new ListStandardMappingsQuery(userId));
  }

  getStandard(userId: string, id: string): Promise<StandardMappingView> {
    return this.queries.execute(new GetStandardMappingQuery(userId, id));
  }

  takeStandard(
    userId: string,
    id: string,
    target?: { projectId: string; projectFileId: string },
  ): Promise<TakenStandardMapping> {
    return this.commands.execute(
      new TakeStandardMappingCommand(userId, id, target),
    );
  }

  forProject(userId: string, projectId: string): Promise<ProjectSuggestions> {
    return this.queries.execute(
      new ProjectMappingSuggestionsQuery(userId, projectId),
    );
  }

  preview(
    userId: string,
    projectId: string,
    projectFileId: string,
    source: SuggestionSource,
    id: string,
    limit: number,
  ): Promise<SuggestionPreview> {
    return this.queries.execute(
      new SuggestionPreviewQuery(
        userId,
        projectId,
        projectFileId,
        source,
        id,
        limit,
      ),
    );
  }
}
