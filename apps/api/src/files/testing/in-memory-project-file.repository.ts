import type {
  FileAnalysis,
  FileDeactivation,
  ProjectFile,
  StoredFileContent,
  StoredFileMeta,
  UserFile,
} from '../domain/project-file';
import {
  type AddProjectFileInput,
  type MappingUse,
  type NewStoredFile,
  ProjectFileRepositoryPort,
} from '../ports/project-file.repository.port';

interface Entry {
  readonly id: string;
  readonly projectId: string;
  readonly fileId: string;
  readonly displayName: string;
  readonly origin: string;
  readonly addedAt: string;
  deactivation: FileDeactivation | null;
}

/** A stored file of the double: bytes, facts and its reading (F5.21). */
export interface InMemoryStoredFile extends StoredFileContent {
  analysis: FileAnalysis;
  readonly source: string;
}

/**
 * Port double for handler specs: a real implementation of the contract over Maps, not an ORM
 * mock. The Prisma adapter is held to the same contract by persistence.integration.spec.ts.
 */
export class InMemoryProjectFileRepository extends ProjectFileRepositoryPort {
  readonly stored = new Map<string, InMemoryStoredFile>();
  readonly entries = new Map<string, Entry>();
  private seq = 0;
  private clock = Date.parse('2026-01-01T00:00:00.000Z');

  async findStoredBySha(
    ownerId: string,
    sha256: string,
  ): Promise<StoredFileMeta | undefined> {
    const found = [...this.stored.values()].find(
      (file) => file.ownerId === ownerId && file.sha256 === sha256,
    );
    return found && this.meta(found);
  }

  async readContent(fileId: string): Promise<StoredFileContent | undefined> {
    const found = this.stored.get(fileId);
    return found && { ...this.meta(found), bytes: found.bytes };
  }

  async findInProject(
    projectId: string,
    fileId: string,
  ): Promise<ProjectFile | undefined> {
    const entry = [...this.entries.values()].find(
      (e) => e.projectId === projectId && e.fileId === fileId,
    );
    return entry && this.toFile(entry);
  }

  async firstOtherProjectUsing(
    fileId: string,
    exceptProjectId: string,
  ): Promise<string | undefined> {
    return [...this.entries.values()].find(
      (e) => e.fileId === fileId && e.projectId !== exceptProjectId,
    )?.projectId;
  }

  async findById(id: string): Promise<ProjectFile | undefined> {
    const entry = this.entries.get(id);
    return entry && this.toFile(entry);
  }

  async listByProject(projectId: string): Promise<ProjectFile[]> {
    return [...this.entries.values()]
      .filter((e) => e.projectId === projectId)
      .map((e) => this.toFile(e));
  }

  async listByMapping(mappingId: string): Promise<ProjectFile[]> {
    return [...this.entries.values()]
      .filter(
        (e) => this.stored.get(e.fileId)?.analysis.mappingId === mappingId,
      )
      .map((e) => this.toFile(e));
  }

  async countByMappings(mappingIds: readonly string[]): Promise<MappingUse[]> {
    const counts = new Map<string, MappingUse>();
    for (const entry of this.entries.values()) {
      const mappingId = this.stored.get(entry.fileId)?.analysis.mappingId;
      if (!mappingId || !mappingIds.includes(mappingId)) continue;
      const key = `${mappingId}|${entry.projectId}`;
      const files = (counts.get(key)?.files ?? 0) + 1;
      counts.set(key, { mappingId, projectId: entry.projectId, files });
    }
    return [...counts.values()].sort((a, b) =>
      a.mappingId === b.mappingId
        ? a.projectId.localeCompare(b.projectId)
        : a.mappingId.localeCompare(b.mappingId),
    );
  }

  async add(
    input: AddProjectFileInput,
  ): Promise<{ created: ProjectFile } | { duplicate: ProjectFile }> {
    let fileId: string;
    if ('existingId' in input.stored) {
      fileId = input.stored.existingId;
      // As the adapter: never link another owner's stored bytes.
      if (this.stored.get(fileId)?.ownerId !== input.ownerId) {
        throw new Error('The stored file belongs to another owner');
      }
    } else {
      fileId = this.create(input.ownerId, input.stored.create).id;
    }
    const existing = await this.findInProject(input.projectId, fileId);
    if (existing) return { duplicate: existing };
    this.seq += 1;
    const entry: Entry = {
      id: `pf${this.seq}`,
      projectId: input.projectId,
      fileId,
      displayName: input.displayName,
      origin: input.origin,
      addedAt: this.tick(),
      deactivation: null,
    };
    this.entries.set(entry.id, entry);
    return { created: this.toFile(entry) };
  }

  async updateAnalysis(
    id: string,
    analysis: FileAnalysis,
  ): Promise<ProjectFile | undefined> {
    const entry = this.entries.get(id);
    const stored = entry && this.stored.get(entry.fileId);
    if (!entry || !stored) return undefined;
    stored.analysis = analysis;
    return this.toFile(entry);
  }

  async setDeactivation(
    id: string,
    state: FileDeactivation | null,
  ): Promise<ProjectFile | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    entry.deactivation = state;
    return this.toFile(entry);
  }

  async remove(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async listByOwner(ownerId: string): Promise<UserFile[]> {
    return [...this.stored.values()]
      .filter((file) => file.ownerId === ownerId)
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? b.id.localeCompare(a.id)
          : b.createdAt.localeCompare(a.createdAt),
      )
      .map((file) => this.toUserFile(file));
  }

  async findStored(id: string): Promise<UserFile | undefined> {
    const found = this.stored.get(id);
    return found && this.toUserFile(found);
  }

  async listStoredByMapping(mappingId: string): Promise<UserFile[]> {
    return [...this.stored.values()]
      .filter((file) => file.analysis.mappingId === mappingId)
      .map((file) => this.toUserFile(file));
  }

  async addStored(
    ownerId: string,
    file: NewStoredFile,
  ): Promise<{ created: UserFile } | { duplicate: UserFile }> {
    const existing = await this.findStoredBySha(ownerId, file.sha256);
    const stored = existing && this.stored.get(existing.id);
    if (stored) return { duplicate: this.toUserFile(stored) };
    return { created: this.toUserFile(this.create(ownerId, file)) };
  }

  async updateStoredAnalysis(
    id: string,
    analysis: FileAnalysis,
  ): Promise<UserFile | undefined> {
    const found = this.stored.get(id);
    if (!found) return undefined;
    found.analysis = analysis;
    return this.toUserFile(found);
  }

  async deleteStored(id: string): Promise<boolean> {
    if (!this.stored.delete(id)) return false;
    for (const [entryId, entry] of this.entries) {
      if (entry.fileId === id) this.entries.delete(entryId);
    }
    return true;
  }

  private create(ownerId: string, file: NewStoredFile): InMemoryStoredFile {
    this.seq += 1;
    const created: InMemoryStoredFile = {
      id: `f${this.seq}`,
      ownerId,
      sha256: file.sha256,
      bytes: file.bytes,
      size: file.bytes.length,
      mediaType: file.mediaType,
      kind: file.kind,
      originalName: file.originalName,
      createdAt: this.tick(),
      analysis: file.analysis,
      source: file.source,
    };
    this.stored.set(created.id, created);
    return created;
  }

  private meta(file: InMemoryStoredFile): StoredFileMeta {
    return {
      id: file.id,
      ownerId: file.ownerId,
      sha256: file.sha256,
      size: file.size,
      mediaType: file.mediaType,
      kind: file.kind,
      originalName: file.originalName,
      createdAt: file.createdAt,
    };
  }

  private toUserFile(file: InMemoryStoredFile): UserFile {
    return {
      ...this.meta(file),
      ...file.analysis,
      source: file.source,
      usages: [...this.entries.values()]
        .filter((e) => e.fileId === file.id)
        .map((e) => ({
          projectFileId: e.id,
          projectId: e.projectId,
          active: e.deactivation === null,
        })),
    };
  }

  private toFile(entry: Entry): ProjectFile {
    const stored = this.stored.get(entry.fileId);
    if (!stored) throw new Error('dangling entry');
    return {
      ...stored.analysis,
      id: entry.id,
      projectId: entry.projectId,
      fileId: entry.fileId,
      sha256: stored.sha256,
      kind: stored.kind,
      size: stored.size,
      mediaType: stored.mediaType,
      displayName: entry.displayName,
      origin: entry.origin,
      addedAt: entry.addedAt,
      disabledAt: entry.deactivation?.at ?? null,
      disabledNote: entry.deactivation?.note ?? null,
    };
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
}
