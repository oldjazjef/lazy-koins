import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  type HeaderMatchRequest,
  matchEntries,
  publicEntry,
  publicEntryDetail,
  type PublicLibraryEntry,
  type PublicLibraryEntryDetail,
  type PublicLibraryPage,
  publicPage,
  type PublicLibrarySearch,
} from '../domain/public-library';
import { LibraryRepositoryPort } from '../ports/library.repository.port';
import { loadActiveEntry } from './library-access';
import { LibraryRuntime } from './library-runtime';

/**
 * F5.18, web side: the public, read-only face of the library — no user, no session. Every
 * answer goes through the allow-list in `public-library.ts`; deleted entries do not exist here.
 * Off (404) on the desktop and with `LIBRARY_PUBLIC=false`.
 */
export class PublicLibraryPageQuery {
  constructor(readonly search: PublicLibrarySearch) {}
}

@QueryHandler(PublicLibraryPageQuery)
export class PublicLibraryPageHandler implements IQueryHandler<
  PublicLibraryPageQuery,
  PublicLibraryPage
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    search,
  }: PublicLibraryPageQuery): Promise<PublicLibraryPage> {
    this.runtime.assertPublic();
    return publicPage(await this.library.listActive(), search);
  }
}

export class PublicLibraryEntryQuery {
  constructor(readonly libraryId: string) {}
}

@QueryHandler(PublicLibraryEntryQuery)
export class PublicLibraryEntryHandler implements IQueryHandler<
  PublicLibraryEntryQuery,
  PublicLibraryEntryDetail
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    libraryId,
  }: PublicLibraryEntryQuery): Promise<PublicLibraryEntryDetail> {
    this.runtime.assertPublic();
    return publicEntryDetail(await loadActiveEntry(this.library, libraryId));
  }
}

export class PublicLibraryMatchQuery {
  constructor(readonly request: HeaderMatchRequest) {}
}

/** Entries that would read a file with this header row + name (stateless; nothing is stored). */
@QueryHandler(PublicLibraryMatchQuery)
export class PublicLibraryMatchHandler implements IQueryHandler<
  PublicLibraryMatchQuery,
  PublicLibraryEntry[]
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    request,
  }: PublicLibraryMatchQuery): Promise<PublicLibraryEntry[]> {
    this.runtime.assertPublic();
    return matchEntries(await this.library.listActive(), request).map(
      publicEntry,
    );
  }
}
