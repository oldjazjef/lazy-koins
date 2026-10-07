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
import {
  GetRemoteLibraryMappingQuery,
  GetRemoteLibrarySettingsQuery,
  LibraryStatusQuery,
  RemoteProjectLibraryMatchesQuery,
  type RemoteLibraryTest,
  SaveRemoteLibrarySettingsCommand,
  SearchRemoteLibraryQuery,
  TakeRemoteLibraryMappingCommand,
  TestRemoteLibraryQuery,
} from './application/remote-library.handlers';
import type {
  LibraryEntryDetail,
  LibraryEntryView,
  PublishReview,
} from './domain/library-mapping';
import type {
  LibraryStatus,
  RemoteLibrarySettings,
  SaveRemoteLibrarySettings,
} from './domain/remote-library';

/**
 * Thin façade over the buses — no logic here; it lives in the handlers. The one decision it
 * makes is where a read or a take goes: this deployment's library (web) or the linked web
 * deployment's public library (desktop, F5.18). Publish, review, rate and delete exist only on
 * the web (their handlers answer 404 on the desktop).
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly runtime: LibraryRuntime,
  ) {}

  /** False on the desktop (`AUTH_MODE=local`): no own library, no publishing tools. */
  get enabled(): boolean {
    return this.runtime.enabled;
  }

  /** `web` = this deployment's library; `remote` = the desktop (F5.18, read-only). */
  get mode(): 'web' | 'remote' {
    return this.runtime.mode;
  }

  search(userId: string, search: LibrarySearch): Promise<LibraryEntryView[]> {
    return this.queries.execute(
      this.runtime.remote
        ? new SearchRemoteLibraryQuery(userId, search)
        : new SearchLibraryQuery(userId, search),
    );
  }

  get(userId: string, libraryId: string): Promise<LibraryEntryDetail> {
    return this.queries.execute(
      this.runtime.remote
        ? new GetRemoteLibraryMappingQuery(userId, libraryId)
        : new GetLibraryMappingQuery(userId, libraryId),
    );
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
      this.runtime.remote
        ? new TakeRemoteLibraryMappingCommand(userId, libraryId, target)
        : new TakeLibraryMappingCommand(userId, libraryId, target),
    );
  }

  matchesForProject(
    userId: string,
    projectId: string,
  ): Promise<LibraryFileMatches[]> {
    return this.queries.execute(
      this.runtime.remote
        ? new RemoteProjectLibraryMatchesQuery(userId, projectId)
        : new ProjectLibraryMatchesQuery(userId, projectId),
    );
  }

  status(userId: string): Promise<LibraryStatus> {
    return this.queries.execute(new LibraryStatusQuery(userId));
  }

  remoteSettings(userId: string): Promise<RemoteLibrarySettings> {
    return this.queries.execute(new GetRemoteLibrarySettingsQuery(userId));
  }

  saveRemoteSettings(
    userId: string,
    settings: SaveRemoteLibrarySettings,
  ): Promise<RemoteLibrarySettings> {
    return this.commands.execute(
      new SaveRemoteLibrarySettingsCommand(userId, settings),
    );
  }

  testRemote(userId: string, url?: string): Promise<RemoteLibraryTest> {
    return this.queries.execute(new TestRemoteLibraryQuery(userId, url));
  }
}
