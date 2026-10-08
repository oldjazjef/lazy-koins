import { Injectable } from '@nestjs/common';
import {
  MAPPING_VERSION,
  mappingFingerprint,
  type RateEntry,
} from '@lazykoins/engine';
import type {
  ProjectCarryover as CarryoverRow,
  Prisma,
} from '../../../generated/prisma/client';
import {
  type BundleResult,
  CARRIED_PREFIX,
  type Carryover,
  type CarryoverKind,
  type ProjectBundle,
} from '../../../carryover/domain/carryover';
import {
  CarryoverRepositoryPort,
  ProjectBundleRepositoryPort,
} from '../../../carryover/ports/carryover.repository.port';
import { DERIVED_FROM } from '../../../files/domain/project-file';
import { UserRateRepositoryPort } from '../../../dashboard/ports/user-rate.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toCarryover(row: CarryoverRow): Carryover {
  const data: unknown = JSON.parse(row.data);
  return {
    id: row.id,
    projectId: row.projectId,
    sourceProjectId: row.sourceProjectId,
    sourceProjectName: row.sourceProjectName,
    kind: row.kind as CarryoverKind,
    ref: row.ref,
    label: row.label,
    data:
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {},
    createdAt: toIsoString(row.createdAt),
  };
}

@Injectable()
export class CarryoverPrismaRepository extends CarryoverRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByProject(projectId: string): Promise<Carryover[]> {
    const rows = await this.prisma.projectCarryover.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCarryover);
  }
}

/**
 * Every existing row a bundle references (target project, reused mappings and stored files,
 * wallets) must belong to `ownerId` — else the whole transaction rolls back. Defence in depth
 * (F11.16 audit): the handlers already check ownership.
 */
async function assertOwnedBy(
  tx: Prisma.TransactionClient,
  ownerId: string,
  bundle: ProjectBundle,
): Promise<void> {
  const foreign = (what: string): never => {
    throw new Error(`Bundle: the ${what} belongs to another owner`);
  };
  if ('existingProjectId' in bundle.target) {
    const project = await tx.project.findFirst({
      where: { id: bundle.target.existingProjectId, ownerId },
      select: { id: true },
    });
    if (!project) foreign('target project');
  }
  const mappingIds = bundle.mappings.flatMap((m) =>
    m.existingId ? [m.existingId] : [],
  );
  const storedIds = bundle.files.flatMap((f) =>
    'existingId' in f.stored ? [f.stored.existingId] : [],
  );
  const walletIds = bundle.walletIds ?? [];
  const count = async (
    ids: readonly string[],
    counter: (unique: string[]) => Promise<number>,
    what: string,
  ) => {
    const unique = [...new Set(ids)];
    if (unique.length > 0 && (await counter(unique)) !== unique.length) {
      foreign(what);
    }
  };
  await count(
    mappingIds,
    (ids) => tx.importMapping.count({ where: { id: { in: ids }, ownerId } }),
    'mapping',
  );
  await count(
    storedIds,
    (ids) => tx.storedFile.count({ where: { id: { in: ids }, ownerId } }),
    'stored file',
  );
  await count(
    walletIds,
    (ids) => tx.wallet.count({ where: { id: { in: ids }, ownerId } }),
    'wallet',
  );
}

function need<T>(map: ReadonlyMap<string, T>, key: string, what: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Bundle: unknown ${what} ${key}`);
  return value;
}

/** One interactive transaction for a whole bundle (F4.4, F4.4a, F10.8). */
@Injectable()
export class ProjectBundlePrismaRepository extends ProjectBundleRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async write(ownerId: string, bundle: ProjectBundle): Promise<BundleResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const projectId =
          'create' in bundle.target
            ? (
                await tx.project.create({
                  data: { ownerId, ...bundle.target.create },
                  select: { id: true },
                })
              ).id
            : bundle.target.existingProjectId;
        // Defence in depth (F11.16 audit): a bundle may only reference the owner's own rows.
        // The handlers check ownership; this keeps a slip there from crossing users.
        await assertOwnedBy(tx, ownerId, bundle);

        const mappingIds = new Map<string, string>();
        let mappingsCreated = 0;
        let mappingsReused = 0;
        for (const mapping of bundle.mappings) {
          if (mapping.existingId) {
            mappingIds.set(mapping.key, mapping.existingId);
            mappingsReused += 1;
          } else if (mapping.create) {
            const { spec, origin } = mapping.create;
            const row = await tx.importMapping.create({
              data: {
                ownerId,
                name: spec.name,
                platform: spec.platform,
                spec: JSON.stringify(spec),
                fingerprint: mappingFingerprint(spec),
                version: MAPPING_VERSION,
                origin,
              },
              select: { id: true },
            });
            mappingIds.set(mapping.key, row.id);
            mappingsCreated += 1;
          }
        }

        const fileIds = new Map<string, string>();
        let storedFilesCreated = 0;
        // Files a derived file points to come first.
        const ordered = [...bundle.files].sort(
          (a, b) =>
            Number(a.derivedFromKey !== undefined) -
            Number(b.derivedFromKey !== undefined),
        );
        for (const file of ordered) {
          const mappingId = file.mappingKey
            ? need(mappingIds, file.mappingKey, 'mapping')
            : null;
          const analysis = file.analysis;
          let storedId: string;
          if ('existingId' in file.stored) storedId = file.stored.existingId;
          else {
            const existing = await tx.storedFile.findUnique({
              where: {
                ownerId_sha256: {
                  ownerId,
                  sha256: file.stored.create.sha256,
                },
              },
              select: { id: true },
            });
            // F5.21: a file the owner already has keeps its reading; a new one takes the
            // bundle's (with the bundle's mapping).
            if (existing) storedId = existing.id;
            else {
              const create = file.stored.create;
              storedId = (
                await tx.storedFile.create({
                  data: {
                    ownerId,
                    sha256: create.sha256,
                    bytes: new Uint8Array(create.bytes),
                    size: create.bytes.length,
                    mediaType: create.mediaType,
                    kind: create.kind,
                    originalName: create.originalName,
                    status:
                      analysis.status === 'mapped' && !mappingId
                        ? 'needs_mapping'
                        : analysis.status,
                    importerId: mappingId
                      ? `mapping:${mappingId}`
                      : analysis.importerId,
                    mappingId: analysis.status === 'mapped' ? mappingId : null,
                    platform: analysis.platform,
                    periodFrom: analysis.period?.from ?? null,
                    periodTo: analysis.period?.to ?? null,
                    bookingCount: analysis.bookingCount,
                    holdingCount: analysis.holdingCount,
                    errorCount: analysis.errorCount,
                    coverage: JSON.stringify(analysis.coverage),
                  },
                  select: { id: true },
                })
              ).id;
              storedFilesCreated += 1;
            }
          }
          const already = await tx.projectFile.findUnique({
            where: { projectId_fileId: { projectId, fileId: storedId } },
            select: { id: true },
          });
          if (already) {
            fileIds.set(file.key, already.id);
            continue;
          }
          const row = await tx.projectFile.create({
            data: {
              projectId,
              fileId: storedId,
              displayName: file.displayName,
              origin: file.derivedFromKey
                ? `${DERIVED_FROM}${need(fileIds, file.derivedFromKey, 'file')}`
                : file.origin,
              // F5.7a: a package keeps a file deactivated; carry-over links active.
              disabledAt: file.deactivation
                ? new Date(file.deactivation.at)
                : null,
              disabledNote: file.deactivation?.note ?? null,
            },
            select: { id: true },
          });
          fileIds.set(file.key, row.id);
        }

        const correctionIds = new Map<string, string>();
        for (const correction of bundle.corrections) {
          const row = await tx.correction.create({
            data: {
              projectId,
              type: correction.data.type,
              data: JSON.stringify(correction.data),
              reason: correction.reason,
              ...(correction.createdAt
                ? { createdAt: new Date(correction.createdAt) }
                : {}),
              undoneAt: correction.undoneAt
                ? new Date(correction.undoneAt)
                : null,
            },
            select: { id: true },
          });
          correctionIds.set(correction.key, row.id);
        }

        await upsertRates(tx, projectId, bundle.rates);

        for (const item of bundle.exports) {
          await tx.projectExport.create({
            data: {
              projectId,
              kind: item.kind,
              fileName: item.fileName,
              mediaType: item.kind.endsWith('_pdf')
                ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              bytes: new Uint8Array(item.bytes),
              size: item.bytes.length,
              snapshotId: null,
              wealthChf: item.wealthChf,
              incomeChf: item.incomeChf,
              ...(item.createdAt
                ? { createdAt: new Date(item.createdAt) }
                : {}),
            },
          });
        }

        const carryoverIds = new Map<string, string>();
        for (const carryover of bundle.carryovers) {
          const row = await tx.projectCarryover.create({
            data: {
              projectId,
              sourceProjectId: carryover.sourceProjectId,
              sourceProjectName: carryover.sourceProjectName,
              kind: carryover.kind,
              ref: carryover.refFileKey
                ? (fileIds.get(carryover.refFileKey) ?? null)
                : carryover.refCorrectionKey
                  ? (correctionIds.get(carryover.refCorrectionKey) ?? null)
                  : null,
              label: carryover.label,
              data: JSON.stringify(carryover.data),
            },
            select: { id: true },
          });
          if (carryover.key) carryoverIds.set(carryover.key, row.id);
        }

        for (const walletId of bundle.walletIds ?? []) {
          await tx.projectWallet.upsert({
            where: { projectId_walletId: { projectId, walletId } },
            create: { projectId, walletId },
            update: {},
          });
        }

        for (const state of bundle.openItemStates) {
          const itemKey = state.carryoverKey
            ? `${CARRIED_PREFIX}${need(carryoverIds, state.carryoverKey, 'carry-over')}`
            : state.itemKey;
          if (!itemKey) continue;
          await tx.openItemState.upsert({
            where: { projectId_itemKey: { projectId, itemKey } },
            create: {
              projectId,
              itemKey,
              done: state.done,
              note: state.note,
            },
            update: { done: state.done, note: state.note },
          });
        }

        return {
          projectId,
          files: fileIds.size,
          mappingsCreated,
          mappingsReused,
          storedFilesCreated,
          corrections: correctionIds.size,
        };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}

type Tx = Parameters<
  Parameters<PrismaService['$transaction']>[0] extends (tx: infer T) => unknown
    ? (tx: T) => unknown
    : never
>[0];

async function upsertRates(
  tx: Tx,
  projectId: string,
  entries: readonly RateEntry[],
): Promise<void> {
  for (const entry of entries) {
    await tx.projectRate.upsert({
      where: {
        projectId_kind_asset_currency_date_source: {
          projectId,
          kind: entry.kind,
          asset: entry.asset,
          currency: entry.currency,
          date: entry.date,
          source: entry.source,
        },
      },
      create: { projectId, ...entry },
      update: { value: entry.value },
    });
  }
}

const CHUNK = 200;

/** The user's own rate cache (F11.4). */
@Injectable()
export class UserRatePrismaRepository extends UserRateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByUser(userId: string): Promise<RateEntry[]> {
    const rows = await this.prisma.userRate.findMany({
      where: { userId },
      orderBy: [
        { kind: 'asc' },
        { asset: 'asc' },
        { currency: 'asc' },
        { date: 'asc' },
        { source: 'asc' },
      ],
    });
    return rows.map((row) => ({
      kind: row.kind as RateEntry['kind'],
      asset: row.asset,
      currency: row.currency as RateEntry['currency'],
      date: row.date,
      value: row.value,
      source: row.source as RateEntry['source'],
    }));
  }

  async upsertMany(
    userId: string,
    entries: readonly RateEntry[],
  ): Promise<number> {
    const usable = entries.filter(
      (e) => e.source !== 'manual' && e.source !== 'estv',
    );
    for (let start = 0; start < usable.length; start += CHUNK) {
      const chunk = usable.slice(start, start + CHUNK);
      await this.prisma.$transaction(
        chunk.map((entry) =>
          this.prisma.userRate.upsert({
            where: {
              userId_kind_asset_currency_date_source: {
                userId,
                kind: entry.kind,
                asset: entry.asset,
                currency: entry.currency,
                date: entry.date,
                source: entry.source,
              },
            },
            create: { userId, ...entry },
            update: { value: entry.value, fetchedAt: new Date() },
          }),
        ),
      );
    }
    return usable.length;
  }

  async deletePrices(userId: string, asset: string): Promise<number> {
    const { count } = await this.prisma.userRate.deleteMany({
      where: { userId, kind: 'price', asset },
    });
    return count;
  }
}
