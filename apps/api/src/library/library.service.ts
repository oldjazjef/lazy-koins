import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  DeleteLibraryMappingCommand,
  type PublishInput,
  PublishLibraryMappingCommand,
  RateLibraryMappingCommand,
  type TakenLibraryMapping,
  TakeLibraryMappingCommand,
} from './application/library.commands';
import type { PublishRequest } from './application/library-access';
import {
  GetLibraryMappingQuery,
  type LibraryFileMatches,
  type LibrarySearch,
  ProjectLibraryMatchesQuery,
  ReviewPublicationQuery,
  SearchLibraryQuery,
} from './application/library.queries';
import { LibraryRuntime } from './application/library-runtime';
import type {
  LibraryEntryDetail,
  LibraryEntryView,
  PublishReview,
} from './domain/library-mapping';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class LibraryService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly runtime: LibraryRuntime,
  ) {}

  /** False on the desktop (`AUTH_MODE=local`): no routes, no tools. */
  get enabled(): boolean {
    return this.runtime.enabled;
  }

  search(userId: string, search: LibrarySearch): Promise<LibraryEntryView[]> {
    return this.queries.execute(new SearchLibraryQuery(userId, search));
  }

  get(userId: string, libraryId: string): Promise<LibraryEntryDetail> {
    return this.queries.execute(new GetLibraryMappingQuery(userId, libraryId));
  }

  review(userId: string, request: PublishRequest): Promise<PublishReview> {
    return this.queries.execute(new ReviewPublicationQuery(userId, request));
  }

  publish(userId: string, input: PublishInput): Promise<LibraryEntryView> {
    return this.commands.execute(
      new PublishLibraryMappingCommand(userId, input),
    );
  }

  remove(userId: string, libraryId: string): Promise<void> {
    return this.commands.execute(
      new DeleteLibraryMappingCommand(userId, libraryId),
    );
  }

  rate(
    userId: string,
    libraryId: string,
    stars: number | null,
  ): Promise<LibraryEntryView> {
    return this.commands.execute(
      new RateLibraryMappingCommand(userId, libraryId, stars),
    );
  }

  take(
    userId: string,
    libraryId: string,
    target?: { projectId: string; projectFileId: string },
  ): Promise<TakenLibraryMapping> {
    return this.commands.execute(
      new TakeLibraryMappingCommand(userId, libraryId, target),
    );
  }

  matchesForProject(
    userId: string,
    projectId: string,
  ): Promise<LibraryFileMatches[]> {
    return this.queries.execute(
      new ProjectLibraryMatchesQuery(userId, projectId),
    );
  }
}
