import type { FileKind } from '@lazykoins/engine';
import type {
  FileAnalysis,
  FileDeactivation,
  ProjectFile,
  StoredFileContent,
  StoredFileMeta,
  UserFile,
} from '../domain/project-file';

export interface NewStoredFile {
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly kind: FileKind;
  readonly originalName: string;
  /** How the new file is read (F5.21: the reading belongs to the file). */
  readonly analysis: FileAnalysis;
  /** `uploaded`, `derived_from:<stored file id>` or `wallet:<wallet id>`. */
  readonly source: string;
}

export interface AddProjectFileInput {
  readonly ownerId: string;
  readonly projectId: string;
  /**
   * An existing stored file of the owner (its reading stays as it is) or new bytes to store with
   * their reading.
   */
  readonly stored:
    { readonly existingId: string } | { readonly create: NewStoredFile };
  readonly displayName: string;
  readonly origin: string;
}

/** How many files of one project a mapping read (counts only). */
export interface MappingUse {
  readonly mappingId: string;
  readonly projectId: string;
  readonly files: number;
}

/**
 * Persistence contract for the user's files (F5.21) and their selection in projects (F5.22).
 * Ownership is checked by the handlers; the adapter keeps the invariants that need a
 * transaction. A stored file outlives its projects (F5.23): only `deleteStored` removes bytes.
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

  /** Every project entry of a file a mapping reads (any project of its owner). */
  abstract listByMapping(mappingId: string): Promise<ProjectFile[]>;

  /**
   * For each of these mappings, the projects that select files it reads and how many — no file
   * rows with bytes loaded (the global mappings list). Sorted by mapping, then project.
   */
  abstract countByMappings(
    mappingIds: readonly string[],
  ): Promise<MappingUse[]>;

  /**
   * Stores the bytes with their reading (unless they exist — then the reading stays) and adds
   * the project entry, in one transaction. A concurrent duplicate surfaces as `{ duplicate }`.
   */
  abstract add(
    input: AddProjectFileInput,
  ): Promise<{ created: ProjectFile } | { duplicate: ProjectFile }>;

  /** Changes how the entry's stored file is read — for every project that selects it (F5.21). */
  abstract updateAnalysis(
    id: string,
    analysis: FileAnalysis,
  ): Promise<ProjectFile | undefined>;

  /**
   * F5.7a: deactivates the project file (`state`) or activates it again (`null`). Only this
   * project's entry changes — the stored file and its other projects are untouched.
   */
  abstract setDeactivation(
    id: string,
    state: FileDeactivation | null,
  ): Promise<ProjectFile | undefined>;

  /**
   * F5.23 "Aus Projekt entfernen": removes the entry; the stored file stays among the user's
   * files. `false` when there was no entry.
   */
  abstract remove(id: string): Promise<boolean>;

  // --- The user's files (F5.21) ---

  /** Every stored file of the owner with its reading and its projects, newest first. */
  abstract listByOwner(ownerId: string): Promise<UserFile[]>;

  abstract findStored(id: string): Promise<UserFile | undefined>;

  /** Every stored file a mapping reads. */
  abstract listStoredByMapping(mappingId: string): Promise<UserFile[]>;

  /**
   * Stores new bytes with their reading, outside any project (the global upload). A file the
   * owner already has (or a concurrent upload of the same bytes) is `{ duplicate }`.
   */
  abstract addStored(
    ownerId: string,
    file: NewStoredFile,
  ): Promise<{ created: UserFile } | { duplicate: UserFile }>;

  /** Changes how a stored file is read (F5.21). */
  abstract updateStoredAnalysis(
    id: string,
    analysis: FileAnalysis,
  ): Promise<UserFile | undefined>;

  /** F5.23: deletes the bytes and every project entry of them. `false` when it did not exist. */
  abstract deleteStored(id: string): Promise<boolean>;
}
