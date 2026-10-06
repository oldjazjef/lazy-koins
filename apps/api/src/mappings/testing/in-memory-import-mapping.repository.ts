import { MAPPING_VERSION, mappingFingerprint } from '@lazykoins/engine';
import type { InMemoryProjectFileRepository } from '../../files/testing/in-memory-project-file.repository';
import { NOT_ANALYSED } from '../../files/domain/project-file';
import type { ImportMapping, SaveMappingInput } from '../domain/import-mapping';
import { ImportMappingRepositoryPort } from '../ports/import-mapping.repository.port';

/** Port double over a Map; `files` (optional) receives the reset on delete, as the adapter does. */
export class InMemoryImportMappingRepository extends ImportMappingRepositoryPort {
  readonly rows = new Map<string, ImportMapping>();
  private seq = 0;

  constructor(private readonly files?: InMemoryProjectFileRepository) {
    super();
  }

  async findByOwner(ownerId: string): Promise<ImportMapping[]> {
    return [...this.rows.values()]
      .filter((mapping) => mapping.ownerId === ownerId)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async findById(id: string): Promise<ImportMapping | undefined> {
    return this.rows.get(id);
  }

  async create(
    ownerId: string,
    input: SaveMappingInput,
  ): Promise<ImportMapping> {
    this.seq += 1;
    const mapping: ImportMapping = {
      id: `m${this.seq}`,
      ownerId,
      name: input.spec.name,
      platform: input.spec.platform,
      spec: input.spec,
      fingerprint: mappingFingerprint(input.spec),
      version: MAPPING_VERSION,
      origin: input.origin,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(mapping.id, mapping);
    return mapping;
  }

  async update(
    id: string,
    input: SaveMappingInput,
  ): Promise<ImportMapping | undefined> {
    const existing = this.rows.get(id);
    if (!existing) return undefined;
    const updated: ImportMapping = {
      ...existing,
      name: input.spec.name,
      platform: input.spec.platform,
      spec: input.spec,
      fingerprint: mappingFingerprint(input.spec),
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<number> {
    let reset = 0;
    if (this.files) {
      for (const file of await this.files.listByMapping(id)) {
        await this.files.updateAnalysis(file.id, NOT_ANALYSED);
        reset += 1;
      }
    }
    this.rows.delete(id);
    return reset;
  }
}
