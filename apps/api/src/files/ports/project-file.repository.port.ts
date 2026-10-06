import type { FileKind } from '@lazykoins/engine';
import type {
  FileAnalysis,
  ProjectFile,
  StoredFileContent,
  StoredFileMeta,
} from '../domain/project-file';

export interface NewStoredFile {
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly kind: FileKind;
  readonly originalName: string;
}

export interface AddProjectFileInput {
  readonly ownerId: string;
  readonly projectId: string;
  /** An existing stored file of the owner (same bytes, F4.4) or new bytes to store. */
  readonly stored:
    { readonly existingId: string } | { readonly create: NewStoredFile };
  readonly displayName: string;
  readonly origin: string;
  readonly analysis: FileAnalysis;
}

/**
 * Persistence contract for stored files and their use in projects. Ownership is checked by the
 * handlers; the adapter keeps the invariants that need a transaction (F5.7: a stored file goes
 * with its last reference).
 */
export abstract class ProjectFileRepositoryPort {
  /** The owner's stored file with these bytes, if any (F5.4). */
  abstract findStoredBySha(
    ownerId: string,
    sha256: string,
  ): Promise<StoredFileMeta | undefined>;

  abstract readContent(fileId: string): Promise<StoredFileContent | undefined>;

  /** The project's entry for a stored file, if the file is already in it. */
  abstract findInProject(
    projectId: string,
    fileId: string,
  ): Promise<ProjectFile | undefined>;

  /** Another project (oldest entry first) that already holds the stored file. */
  abstract firstOtherProjectUsing(
    fileId: string,
    exceptProjectId: string,
  ): Promise<string | undefined>;

  abstract findById(id: string): Promise<ProjectFile | undefined>;

  /** The project's files, oldest first. */
  abstract listByProject(projectId: string): Promise<ProjectFile[]>;

  /** Every project file a mapping read (any project of its owner). */
  abstract listByMapping(mappingId: string): Promise<ProjectFile[]>;

  /**
   * Stores the bytes (unless they exist) and adds the entry, in one transaction. A concurrent
   * duplicate surfaces as `{ duplicate }` with the entry that won.
   */
  abstract add(
    input: AddProjectFileInput,
  ): Promise<{ created: ProjectFile } | { duplicate: ProjectFile }>;

  abstract updateAnalysis(
    id: string,
    analysis: FileAnalysis,
  ): Promise<ProjectFile | undefined>;

  /**
   * Removes the entry; the stored file goes too when nothing references it any more — in the
   * same transaction (F5.7). `undefined` when there was no entry.
   */
  abstract remove(
    id: string,
  ): Promise<{ storedFileDeleted: boolean } | undefined>;
}
