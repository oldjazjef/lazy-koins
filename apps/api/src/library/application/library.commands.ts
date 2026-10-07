import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { classifyPrivateValue, type PrivacyFinding } from '@lazykoins/engine';
import { conflict } from '../../common/http/api-errors';
import { ChangeProjectFileCommand } from '../../files/application/commands/change-project-file.command';
import {
  assertOpen,
  loadOwnProjectFile,
  readableOf,
} from '../../files/application/file-access';
import type { ProjectFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  cleanAuthorName,
  cleanDescription,
  entryView,
  LIBRARY_LIMITS,
  type LibraryEntryView,
} from '../domain/library-mapping';
import { LibraryRepositoryPort } from '../ports/library.repository.port';
import {
  assertSpecSize,
  buildReview,
  loadActiveEntry,
  loadOwnEntry,
  privacyRefusal,
  type PublishRequest,
  publishLimit,
} from './library-access';
import { LibraryRuntime } from './library-runtime';

export interface PublishInput extends PublishRequest {
  readonly description?: string | null;
  /** The pseudonym shown in the library; empty = "Anonym". Never the profile name or e-mail. */
  readonly authorName?: string | null;
  /** The author saw the exact JSON (the review step) and confirms publishing it. */
  readonly confirmed: boolean;
  /** Keep the remaining findings on purpose (false positives). */
  readonly acknowledgeFindings?: boolean;
}

export class PublishLibraryMappingCommand {
  constructor(
    readonly userId: string,
    readonly input: PublishInput,
  ) {}
}

/**
 * Publishes ("raufladen", F5.15) one of my mappings or an uploaded spec — a new entry, or a new
 * version of my own entry (`libraryId`; consumers keep their copies). Only after the review:
 * `confirmed` is required, findings must be removed or explicitly kept, the size is capped, and
 * at most `publishesPerDay` new entries per author and day; the same spec twice is a 409.
 */
@CommandHandler(PublishLibraryMappingCommand)
export class PublishLibraryMappingHandler implements ICommandHandler<
  PublishLibraryMappingCommand,
  LibraryEntryView
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    input,
  }: PublishLibraryMappingCommand): Promise<LibraryEntryView> {
    this.runtime.assertEnabled();
    if (input.confirmed !== true) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message:
          'Publishing needs the explicit confirmation of the reviewed JSON (confirmed: true)',
        code: 'confirmationRequired',
      });
    }
    const review = await buildReview(
      { library: this.library, mappings: this.mappings },
      userId,
      input,
    );
    assertSpecSize(review.size);
    if (review.libraryCopy && !review.target) {
      // F5.20: someone else's work taken as a copy is not mine to publish as a new entry.
      throw conflict(
        'libraryCopy',
        'This mapping is a copy taken from the library: it cannot be published as a new entry',
      );
    }
    const publication = {
      authorName: cleanAuthorName(input.authorName),
      sourceMappingId: review.sourceMappingId,
      description: cleanDescription(
        input.description ?? review.spec.description,
      ),
      spec: review.spec,
    };
    // The public texts outside the spec are scanned too: the description shown in the list and
    // the pseudonym (an e-mail or an account number there would defeat the review).
    const findings = [
      ...review.findings,
      ...textFindings({
        '/description': publication.description,
        '/authorName': publication.authorName,
      }),
    ];
    if (findings.length > 0 && input.acknowledgeFindings !== true) {
      throw privacyRefusal(findings);
    }
    if (review.target) {
      const updated = await this.library.publishVersion(
        review.target.id,
        publication,
      );
      if (!updated) throw new NotFoundException('No such library mapping');
      return entryView(updated, userId, null);
    }
    const canonical = JSON.stringify(review.spec);
    const mine = await this.library.findActiveByAuthor(userId);
    const same = mine.find((entry) => JSON.stringify(entry.spec) === canonical);
    if (same) {
      throw conflict(
        'alreadyPublished',
        'You have already published exactly this mapping',
        { libraryId: same.id },
      );
    }
    const since = new Date(
      this.runtime.now().getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    if (
      (await this.library.countPublishedSince(userId, since)) >=
      LIBRARY_LIMITS.publishesPerDay
    ) {
      throw publishLimit();
    }
    return entryView(
      await this.library.create(userId, publication),
      userId,
      null,
    );
  }
}

/** Findings in free texts published next to the spec (never removable — the author edits them). */
function textFindings(
  texts: Readonly<Record<string, string | null>>,
): PrivacyFinding[] {
  const out: PrivacyFinding[] = [];
  for (const [path, text] of Object.entries(texts)) {
    const kind = text ? classifyPrivateValue(text) : null;
    if (text && kind) out.push({ path, kind, value: text, removable: false });
  }
  return out;
}

export class DeleteLibraryMappingCommand {
  constructor(
    readonly userId: string,
    readonly libraryId: string,
  ) {}
}

/**
 * Only the author removes an entry (F5.15) — anyone else gets the 404 of a missing one. A soft
 * delete: it leaves the library, the row stays for the audit, and every copy taken from it keeps
 * working (copies are ordinary mappings of their owners).
 */
@CommandHandler(DeleteLibraryMappingCommand)
export class DeleteLibraryMappingHandler implements ICommandHandler<
  DeleteLibraryMappingCommand,
  void
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    libraryId,
  }: DeleteLibraryMappingCommand): Promise<void> {
    this.runtime.assertEnabled();
    const entry = await loadOwnEntry(this.library, userId, libraryId);
    await this.library.softDelete(entry.id, this.runtime.now().toISOString());
  }
}

export class RateLibraryMappingCommand {
  constructor(
    readonly userId: string,
    readonly libraryId: string,
    /** 1–5, or null to remove my rating. */
    readonly stars: number | null,
  ) {}
}

/** Rating ("geratet", F5.17): 1–5 stars per user, changeable and removable; never one's own. */
@CommandHandler(RateLibraryMappingCommand)
export class RateLibraryMappingHandler implements ICommandHandler<
  RateLibraryMappingCommand,
  LibraryEntryView
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    libraryId,
    stars,
  }: RateLibraryMappingCommand): Promise<LibraryEntryView> {
    this.runtime.assertEnabled();
    if (
      stars !== null &&
      !(Number.isInteger(stars) && stars >= 1 && stars <= 5)
    ) {
      throw new BadRequestException('stars must be 1–5, or null to remove');
    }
    const entry = await loadActiveEntry(this.library, libraryId);
    if (entry.authorId === userId) {
      throw conflict('ownEntry', 'Authors cannot rate their own mapping');
    }
    const updated = await this.library.setRating(entry.id, userId, stars);
    if (!updated) throw new NotFoundException('No such library mapping');
    return entryView(updated, userId, stars);
  }
}

export class TakeLibraryMappingCommand {
  constructor(
    readonly userId: string,
    readonly libraryId: string,
    /** Optional: assign the copy to this file of mine right away ("Aus Bibliothek übernehmen"). */
    readonly target?: {
      readonly projectId: string;
      readonly projectFileId: string;
    },
  ) {}
}

export interface TakenLibraryMapping {
  /** My private copy (origin `library`). */
  readonly mapping: ImportMapping;
  /** False when I already had a copy of exactly this version — it is reused. */
  readonly created: boolean;
  /** The file, read with the copy, when a target was given. */
  readonly file: ProjectFile | null;
}

/**
 * Using ("übernehmen", F5.16) always means a **private copy** in my own mappings (origin
 * `library`, `library:<id>@<version>`): projects use the copy, so the author's later versions or
 * deletion never change my results. A copy of the same version that I still have is reused.
 * With a target the copy is assigned to that file of mine at once — the file's ownership and
 * the project's state are checked **before** anything is copied.
 */
@CommandHandler(TakeLibraryMappingCommand)
export class TakeLibraryMappingHandler implements ICommandHandler<
  TakeLibraryMappingCommand,
  TakenLibraryMapping
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly runtime: LibraryRuntime,
    private readonly commands: CommandBus,
  ) {}

  async execute({
    userId,
    libraryId,
    target,
  }: TakeLibraryMappingCommand): Promise<TakenLibraryMapping> {
    this.runtime.assertEnabled();
    const entry = await loadActiveEntry(this.library, libraryId);
    if (target) {
      const { project, file } = await loadOwnProjectFile(
        this.projects,
        this.files,
        userId,
        target.projectId,
        target.projectFileId,
      );
      assertOpen(project);
      const { readable } = await readableOf(this.files, file);
      if (readable.kind === 'pdf') {
        throw new BadRequestException(
          'A mapping reads tables (CSV, XLSX), not PDFs',
        );
      }
    }
    const reuse = (await this.mappings.findByLibrary(userId, entry.id)).find(
      (mapping) => mapping.library?.version === entry.version,
    );
    let mapping = reuse;
    if (!mapping) {
      mapping = await this.mappings.create(userId, {
        spec: entry.spec,
        origin: 'library',
        library: { id: entry.id, version: entry.version },
      });
      await this.library.incrementUsage(entry.id);
    }
    let file: ProjectFile | null = null;
    if (target) {
      file = await this.commands.execute<ChangeProjectFileCommand, ProjectFile>(
        new ChangeProjectFileCommand(
          userId,
          target.projectId,
          target.projectFileId,
          { mode: 'mapping', mappingId: mapping.id },
        ),
      );
    }
    return { mapping, created: !reuse, file };
  }
}
