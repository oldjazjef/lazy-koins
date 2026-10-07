import type {
  FileAnalysis,
  FileDeactivation,
  ProjectFile,
  StoredFileContent,
  StoredFileMeta,
} from '../domain/project-file';
import {
  type AddProjectFileInput,
  type MappingUse,
  ProjectFileRepositoryPort,
} from '../ports/project-file.repository.port';

interface Entry {
  readonly id: string;
  readonly projectId: string;
  readonly fileId: string;
  readonly displayName: string;
  readonly origin: string;
  readonly addedAt: string;
  analysis: FileAnalysis;
  deactivation: FileDeactivation | null;
}

/**
 * Port double for handler specs: a real implementation of the contract over Maps, not an ORM
 * mock. The Prisma adapter is held to the same contract by persistence.integration.spec.ts.
 */
export class InMemoryProjectFileRepository extends ProjectFileRepositoryPort {
  readonly stored = new Map<string, StoredFileContent>();
  readonly entries = new Map<string, Entry>();
  private seq = 0;
  private clock = Date.parse('2026-01-01T00:00:00.000Z');

  async findStoredBySha(
    ownerId: string,
    sha256: string,
  ): Promise<StoredFileMeta | undefined> {
    return [...this.stored.values()].find(
      (file) => file.ownerId === ownerId && file.sha256 === sha256,
    );
  }

  async readContent(fileId: string): Promise<StoredFileContent | undefined> {
    return this.stored.get(fileId);
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
      .filter((e) => e.analysis.mappingId === mappingId)
      .map((e) => this.toFile(e));
  }

  async countByMappings(mappingIds: readonly string[]): Promise<MappingUse[]> {
    const counts = new Map<string, MappingUse>();
    for (const entry of this.entries.values()) {
      const mappingId = entry.analysis.mappingId;
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
      this.seq += 1;
      fileId = `f${this.seq}`;
      this.stored.set(fileId, {
        id: fileId,
        ownerId: input.ownerId,
        sha256: input.stored.create.sha256,
        bytes: input.stored.create.bytes,
        size: input.stored.create.bytes.length,
        mediaType: input.stored.create.mediaType,
        kind: input.stored.create.kind,
        originalName: input.stored.create.originalName,
        createdAt: this.tick(),
      });
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
      analysis: input.analysis,
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
    if (!entry) return undefined;
    entry.analysis = analysis;
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

  async remove(
    id: string,
  ): Promise<{ storedFileDeleted: boolean } | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    const stillUsed = [...this.entries.values()].some(
      (e) => e.fileId === entry.fileId,
    );
    if (!stillUsed) this.stored.delete(entry.fileId);
    return { storedFileDeleted: !stillUsed };
  }

  private toFile(entry: Entry): ProjectFile {
    const stored = this.stored.get(entry.fileId);
    if (!stored) throw new Error('dangling entry');
    return {
      ...entry.analysis,
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
