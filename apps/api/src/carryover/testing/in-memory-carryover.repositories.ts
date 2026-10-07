import type { InMemoryWalletRepository } from '../../wallets/testing/in-memory-wallet.repository';
import type { RateEntry } from '@lazykoins/engine';
import type {
  InMemoryCorrectionRepository,
  InMemoryOpenItemStateRepository,
} from '../../calculation/testing/in-memory-calculation.repositories';
import { UserRateRepositoryPort } from '../../dashboard/ports/user-rate.repository.port';
import type { InMemoryProjectExportRepository } from '../../exports/testing/in-memory-project-export.repository';
import { DERIVED_FROM } from '../../files/domain/project-file';
import type { InMemoryProjectFileRepository } from '../../files/testing/in-memory-project-file.repository';
import type { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import type { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import type { InMemoryProjectRateRepository } from '../../rates/testing/in-memory-project-rate.repository';
import {
  type BundleResult,
  CARRIED_PREFIX,
  type Carryover,
  type ProjectBundle,
} from '../domain/carryover';
import {
  CarryoverRepositoryPort,
  ProjectBundleRepositoryPort,
} from '../ports/carryover.repository.port';

/** Port double: carry-over rows over an array. */
export class InMemoryCarryoverRepository extends CarryoverRepositoryPort {
  readonly rows: Carryover[] = [];

  async listByProject(projectId: string): Promise<Carryover[]> {
    return this.rows.filter((r) => r.projectId === projectId);
  }
}

/**
 * Port double: writes a bundle into the other doubles (no transaction needed in memory). The
 * Prisma adapter is held to the same behaviour by carryover.persistence.integration.spec.ts.
 */
export class InMemoryProjectBundleRepository extends ProjectBundleRepositoryPort {
  /** Set to make the next write fail half-way (atomicity is the adapter's job; specs check the handler stops). */
  failNext = false;

  constructor(
    private readonly repos: {
      readonly projects: InMemoryProjectRepository;
      readonly files: InMemoryProjectFileRepository;
      readonly mappings: InMemoryImportMappingRepository;
      readonly corrections: InMemoryCorrectionRepository;
      readonly rates: InMemoryProjectRateRepository;
      readonly states: InMemoryOpenItemStateRepository;
      readonly exports: InMemoryProjectExportRepository;
      readonly carryovers: InMemoryCarryoverRepository;
      readonly wallets?: InMemoryWalletRepository;
    },
  ) {
    super();
  }

  async write(ownerId: string, bundle: ProjectBundle): Promise<BundleResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('write failed');
    }
    const r = this.repos;
    const projectId =
      'create' in bundle.target
        ? (await r.projects.create(ownerId, bundle.target.create)).id
        : bundle.target.existingProjectId;
    if ('create' in bundle.target && bundle.target.create.status) {
      await r.projects.update(projectId, {
        status: bundle.target.create.status,
      });
    }
    const mappingIds = new Map<string, string>();
    let mappingsCreated = 0;
    let mappingsReused = 0;
    for (const m of bundle.mappings) {
      if (m.existingId) {
        mappingIds.set(m.key, m.existingId);
        mappingsReused += 1;
      } else if (m.create) {
        mappingIds.set(m.key, (await r.mappings.create(ownerId, m.create)).id);
        mappingsCreated += 1;
      }
    }
    const fileIds = new Map<string, string>();
    const storedBefore = r.files.stored.size;
    const ordered = [...bundle.files].sort(
      (a, b) =>
        Number(a.derivedFromKey !== undefined) -
        Number(b.derivedFromKey !== undefined),
    );
    for (const f of ordered) {
      let stored = f.stored;
      if ('create' in stored) {
        const existing = await r.files.findStoredBySha(
          ownerId,
          stored.create.sha256,
        );
        if (existing) stored = { existingId: existing.id };
      }
      const mappingId = f.mappingKey ? mappingIds.get(f.mappingKey) : null;
      const result = await r.files.add({
        ownerId,
        projectId,
        stored,
        displayName: f.displayName,
        origin: f.derivedFromKey
          ? `${DERIVED_FROM}${fileIds.get(f.derivedFromKey)}`
          : f.origin,
        analysis: {
          ...f.analysis,
          mappingId:
            f.analysis.status === 'mapped' ? (mappingId ?? null) : null,
        },
      });
      if ('created' in result && f.deactivation) {
        await r.files.setDeactivation(result.created.id, f.deactivation);
      }
      fileIds.set(
        f.key,
        'created' in result ? result.created.id : result.duplicate.id,
      );
    }
    const correctionIds = new Map<string, string>();
    for (const c of bundle.corrections) {
      const created = await r.corrections.create(projectId, {
        data: c.data,
        reason: c.reason,
      });
      const kept = {
        ...created,
        createdAt: c.createdAt ?? created.createdAt,
        undoneAt: c.undoneAt ?? null,
      };
      r.corrections.rows.set(created.id, kept);
      correctionIds.set(c.key, created.id);
    }
    await r.rates.upsertMany(projectId, bundle.rates);
    for (const e of bundle.exports) {
      await r.exports.create(projectId, { ...e, snapshotId: null });
    }
    const carryoverIds = new Map<string, string>();
    for (const c of bundle.carryovers) {
      const id = `co${r.carryovers.rows.length + 1}`;
      r.carryovers.rows.push({
        id,
        projectId,
        sourceProjectId: c.sourceProjectId,
        sourceProjectName: c.sourceProjectName,
        kind: c.kind,
        ref: c.refFileKey
          ? (fileIds.get(c.refFileKey) ?? null)
          : c.refCorrectionKey
            ? (correctionIds.get(c.refCorrectionKey) ?? null)
            : null,
        label: c.label,
        data: c.data,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      if (c.key) carryoverIds.set(c.key, id);
    }
    for (const walletId of bundle.walletIds ?? []) {
      await r.wallets?.addToProject(projectId, walletId);
    }
    for (const s of bundle.openItemStates) {
      const itemKey = s.carryoverKey
        ? `${CARRIED_PREFIX}${carryoverIds.get(s.carryoverKey)}`
        : s.itemKey;
      if (itemKey)
        await r.states.save(projectId, itemKey, { done: s.done, note: s.note });
    }
    return {
      projectId,
      files: fileIds.size,
      mappingsCreated,
      mappingsReused,
      storedFilesCreated: r.files.stored.size - storedBefore,
      corrections: correctionIds.size,
    };
  }
}

/** Port double for the dashboard's rate cache. */
export class InMemoryUserRateRepository extends UserRateRepositoryPort {
  readonly rows = new Map<string, RateEntry & { userId: string }>();

  async listByUser(userId: string): Promise<RateEntry[]> {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .map(({ userId: _u, ...entry }) => entry);
  }

  async upsertMany(
    userId: string,
    entries: readonly RateEntry[],
  ): Promise<number> {
    let count = 0;
    for (const e of entries) {
      if (e.source === 'manual' || e.source === 'estv') continue;
      this.rows.set(
        `${userId}|${e.kind}|${e.asset}|${e.currency}|${e.date}|${e.source}`,
        { ...e, userId },
      );
      count += 1;
    }
    return count;
  }

  async deletePrices(userId: string, asset: string): Promise<number> {
    let count = 0;
    for (const [key, row] of this.rows) {
      if (
        row.userId === userId &&
        row.kind === 'price' &&
        row.asset === asset
      ) {
        this.rows.delete(key);
        count += 1;
      }
    }
    return count;
  }
}
