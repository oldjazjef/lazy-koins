import {
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { projectClosed } from '../../common/http/api-errors';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import type { CorrectionData, OpenItem } from '@lazykoins/engine';
import { ProjectNotifications } from '../../notifications/application/project-notifications.service';
import {
  CalculationSnapshotRepositoryPort,
  CorrectionRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../../calculation/ports/calculation.repository.port';
import type { StoredCorrection } from '../../calculation/domain/calculation';
import {
  FROM_PROJECT,
  type ProjectFile,
} from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import { loadOwnProject } from '../../projects/application/project-access';
import {
  isCanton,
  MAX_TAX_YEAR,
  MIN_TAX_YEAR,
  type Project,
} from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  CARRIED_PREFIX,
  type Carryover,
  type ProjectBundle,
} from '../domain/carryover';
import {
  CarryoverRepositoryPort,
  ProjectBundleRepositoryPort,
} from '../ports/carryover.repository.port';
import { WalletDerivedFiles } from '../../wallets/application/wallet-derived-files';
import { originWalletId, type Wallet } from '../../wallets/domain/wallet';
import { WalletRepositoryPort } from '../../wallets/ports/wallet.repository.port';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface FileOption {
  readonly projectFileId: string;
  readonly displayName: string;
  readonly platform: string | null;
  readonly status: ProjectFile['status'];
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly preselected: boolean;
}

export interface WalletOption {
  readonly walletId: string;
  readonly label: string;
  readonly address: string;
  readonly networks: readonly string[];
  readonly preselected: true;
}

/** The project's wallets (the owner's only). */
async function walletsOf(
  wallets: WalletRepositoryPort,
  project: Project,
): Promise<Wallet[]> {
  const ids = await wallets.listWalletIds(project.id);
  return (await wallets.findByIds(ids)).filter(
    (w) => w.ownerId === project.ownerId,
  );
}

/**
 * Files a wallet fetch derived (origin `wallet:`) are never linked: the wallet itself is carried
 * over and makes them anew for the new project (else a later fetch would count them twice).
 */
function isWalletFile(file: ProjectFile): boolean {
  return originWalletId(file.origin) !== undefined;
}

export interface CorrectionOption {
  readonly id: string;
  readonly type: CorrectionData['type'];
  readonly data: CorrectionData;
  readonly reason: string;
  readonly createdAt: string;
  readonly preselected: false;
}

export interface OpenItemOption {
  /** The item's key in the source project (`carried:<id>` for one it carried itself). */
  readonly key: string;
  readonly item: OpenItem;
  readonly note: string;
}

export interface FollowUpOptions {
  readonly source: {
    readonly id: string;
    readonly name: string;
    readonly taxYear: number;
    readonly status: Project['status'];
  };
  readonly taxYear: number;
  readonly country: Project['country'];
  readonly canton: string;
  /** F4.1a: the follow-up project keeps the source's tax currency. */
  readonly taxCurrency: string;
  /** Projects of the owner that already cover the new year (a hint, not a block). */
  readonly existing: readonly { readonly id: string; readonly name: string }[];
  readonly files: readonly FileOption[];
  /** F4.4a with F6: wallets are carried over by linking them (always offered). */
  readonly walletsAvailable: true;
  /** The source project's wallets — preselected; their derived files are made anew. */
  readonly wallets: readonly WalletOption[];
  readonly corrections: readonly CorrectionOption[];
  readonly openItems: readonly OpenItemOption[];
  readonly notes: string;
}

/**
 * F4.4a, which corrections may go along: those that still apply after the year — reclassified
 * bookings of a file whose period reaches into the new year (the booking will be read again
 * there) and manual bookings (positions without a Stichtag). Year-bound ones are never offered:
 * price overrides (31.12.) and manual holdings (dated).
 */
export function carryableCorrections(
  corrections: readonly StoredCorrection[],
  files: readonly ProjectFile[],
  newYear: number,
): StoredCorrection[] {
  const reaching = new Set(
    files
      .filter((f) => (f.period?.to ?? '') >= `${newYear}-01-01`)
      .map((f) => f.sha256),
  );
  return corrections.filter((c) => {
    if (c.undoneAt !== null) return false;
    if (c.data.type === 'manual_booking') return true;
    if (c.data.type === 'reclassify') {
      const sha = c.data.bookingId.split(':')[0] ?? '';
      return reaching.has(sha);
    }
    return false;
  });
}

/** Open items not done yet: the latest calculation's and those carried in earlier. */
async function openItemsOf(
  project: Project,
  snapshots: CalculationSnapshotRepositoryPort,
  states: OpenItemStateRepositoryPort,
  carryovers: CarryoverRepositoryPort,
): Promise<OpenItemOption[]> {
  const stateOf = new Map(
    (await states.listByProject(project.id)).map((s) => [s.itemKey, s]),
  );
  const out: OpenItemOption[] = [];
  const snapshot = await snapshots.latest(project.id);
  for (const item of snapshot?.result.openItems ?? []) {
    const state = stateOf.get(item.key);
    if (state?.done) continue;
    out.push({ key: item.key, item, note: state?.note ?? '' });
  }
  for (const carried of await carryovers.listByProject(project.id)) {
    if (carried.kind !== 'open_item') continue;
    const key = `${CARRIED_PREFIX}${carried.id}`;
    const state = stateOf.get(key);
    if (state?.done) continue;
    const item = carried.data['item'] as OpenItem | undefined;
    if (!item) continue;
    out.push({
      key,
      item,
      note: state?.note ?? String(carried.data['note'] ?? ''),
    });
  }
  return out;
}

// --- F4.4a: options ---

export class GetFollowUpOptionsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(GetFollowUpOptionsQuery)
export class GetFollowUpOptionsHandler implements IQueryHandler<
  GetFollowUpOptionsQuery,
  FollowUpOptions
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly states: OpenItemStateRepositoryPort,
    private readonly carryovers: CarryoverRepositoryPort,
    private readonly wallets: WalletRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: GetFollowUpOptionsQuery): Promise<FollowUpOptions> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const taxYear = project.taxYear + 1;
    const files = (await this.files.listByProject(project.id)).filter(
      (f) => !isWalletFile(f),
    );
    const newYearStart = `${taxYear}-01-01`;
    return {
      source: {
        id: project.id,
        name: project.name,
        taxYear: project.taxYear,
        status: project.status,
      },
      taxYear,
      country: project.country,
      canton: project.canton,
      taxCurrency: project.taxCurrency,
      existing: (await this.projects.findByOwner(userId))
        .filter((p) => p.taxYear === taxYear)
        .map((p) => ({ id: p.id, name: p.name })),
      files: files
        .map((f) => ({
          projectFileId: f.id,
          displayName: f.displayName,
          platform: f.platform,
          status: f.status,
          periodFrom: f.period?.from ?? null,
          periodTo: f.period?.to ?? null,
          preselected: (f.period?.to ?? '') >= newYearStart,
        }))
        .sort(
          (a, b) =>
            compareText(a.platform ?? '', b.platform ?? '') ||
            compareText(a.displayName, b.displayName),
        ),
      walletsAvailable: true,
      wallets: (await walletsOf(this.wallets, project)).map((w) => ({
        walletId: w.id,
        label: w.label,
        address: w.address,
        networks: w.networks,
        preselected: true,
      })),
      corrections: carryableCorrections(
        await this.corrections.listByProject(project.id),
        files,
        taxYear,
      ).map((c) => ({
        id: c.id,
        type: c.type,
        data: c.data,
        reason: c.reason,
        createdAt: c.createdAt,
        preselected: false,
      })),
      openItems: await openItemsOf(
        project,
        this.snapshots,
        this.states,
        this.carryovers,
      ),
      notes: project.notes,
    };
  }
}

// --- F4.4a: create ---

export interface FollowUpInput {
  readonly name: string;
  readonly taxYear: number;
  readonly canton: string;
  readonly fileIds: readonly string[];
  readonly correctionIds: readonly string[];
  readonly openItemKeys: readonly string[];
  readonly notes: boolean;
  /** Wallets of the source project to link (absent = none). */
  readonly walletIds?: readonly string[];
}

export class CreateFollowUpProjectCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly input: FollowUpInput,
  ) {}
}

/**
 * F4.4a: creates the next year's project with what was chosen — files linked (the same stored
 * file, no copy), corrections and open items copied, notes taken over — each recorded as "aus
 * Projekt X", in one transaction. The source project is only read (a closed one is fine).
 */
@CommandHandler(CreateFollowUpProjectCommand)
export class CreateFollowUpProjectHandler implements ICommandHandler<
  CreateFollowUpProjectCommand,
  { projectId: string }
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly states: OpenItemStateRepositoryPort,
    private readonly carryovers: CarryoverRepositoryPort,
    private readonly bundles: ProjectBundleRepositoryPort,
    private readonly wallets: WalletRepositoryPort,
    private readonly derived: WalletDerivedFiles,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    input,
  }: CreateFollowUpProjectCommand): Promise<{ projectId: string }> {
    const source = await loadOwnProject(this.projects, userId, projectId);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('name is required');
    if (
      !Number.isInteger(input.taxYear) ||
      input.taxYear < MIN_TAX_YEAR ||
      input.taxYear > MAX_TAX_YEAR
    ) {
      throw new BadRequestException('taxYear is out of range');
    }
    if (!isCanton(source.country, input.canton)) {
      throw new BadRequestException(`canton: ${input.canton} is not a canton`);
    }

    const sourceFiles = await this.files.listByProject(source.id);
    const fileById = new Map(sourceFiles.map((f) => [f.id, f]));
    const chosenFiles = [...new Set(input.fileIds)]
      .map((id) => {
        const file = fileById.get(id);
        if (!file) throw new NotFoundException('No such file in this project');
        return file;
      })
      .filter((file) => !isWalletFile(file));

    const sourceWallets = new Map(
      (await walletsOf(this.wallets, source)).map((w) => [w.id, w]),
    );
    const chosenWallets = [...new Set(input.walletIds ?? [])].map((id) => {
      const wallet = sourceWallets.get(id);
      if (!wallet)
        throw new NotFoundException('No such wallet in this project');
      return wallet;
    });

    const offered = new Map(
      carryableCorrections(
        await this.corrections.listByProject(source.id),
        sourceFiles,
        input.taxYear,
      ).map((c) => [c.id, c]),
    );
    const chosenCorrections = [...new Set(input.correctionIds)].map((id) => {
      const correction = offered.get(id);
      if (!correction) {
        throw new BadRequestException(
          'This correction cannot be carried over (year-bound or unknown)',
        );
      }
      return correction;
    });

    const open = new Map(
      (
        await openItemsOf(source, this.snapshots, this.states, this.carryovers)
      ).map((o) => [o.key, o]),
    );
    const chosenItems = [...new Set(input.openItemKeys)].map((key) => {
      const item = open.get(key);
      if (!item) throw new BadRequestException('No such open item');
      return item;
    });

    const from = { sourceProjectId: source.id, sourceProjectName: source.name };
    const mappingIds = [
      ...new Set(
        chosenFiles.flatMap((f) => (f.mappingId ? [f.mappingId] : [])),
      ),
    ];
    const bundle: ProjectBundle = {
      target: {
        create: {
          name,
          taxYear: input.taxYear,
          country: source.country,
          canton: input.canton,
          taxCurrency: source.taxCurrency,
          notes: input.notes ? source.notes.trim() : '',
        },
      },
      mappings: mappingIds.map((id) => ({ key: id, existingId: id })),
      files: chosenFiles.map((f) => ({
        key: f.id,
        stored: { existingId: f.fileId },
        displayName: f.displayName,
        origin: `${FROM_PROJECT}${source.id}`,
        analysis: f,
        mappingKey: f.mappingId,
      })),
      corrections: chosenCorrections.map((c) => ({
        key: c.id,
        data: c.data,
        reason: c.reason,
      })),
      rates: [],
      openItemStates: chosenItems
        .filter((o) => o.note !== '')
        .map((o) => ({ carryoverKey: o.key, done: false, note: o.note })),
      exports: [],
      walletIds: chosenWallets.map((w) => w.id),
      carryovers: [
        {
          ...from,
          kind: 'project',
          label: source.name,
          data: { taxYear: source.taxYear },
        },
        ...chosenFiles.map((f) => ({
          ...from,
          kind: 'file' as const,
          refFileKey: f.id,
          label: f.displayName,
          data: { sourceProjectFileId: f.id },
        })),
        ...chosenCorrections.map((c) => ({
          ...from,
          kind: 'correction' as const,
          refCorrectionKey: c.id,
          label: c.reason,
          data: { sourceCorrectionId: c.id, type: c.type },
        })),
        ...chosenItems.map((o) => ({
          ...from,
          key: o.key,
          kind: 'open_item' as const,
          label: o.item.reason,
          data: { item: o.item, note: o.note, sourceKey: o.key },
        })),
        ...chosenWallets.map((w) => ({
          ...from,
          kind: 'wallet' as const,
          label: w.label,
          data: { walletId: w.id, address: w.address },
        })),
        ...(input.notes && source.notes.trim() !== ''
          ? [{ ...from, kind: 'notes' as const, label: '', data: {} }]
          : []),
      ],
    };
    const result = await this.bundles.write(userId, bundle);
    // The wallets' fetched data becomes the new project's derived files (F6.3) — after the
    // transaction, like a wallet added by hand; manual balances (dated 31.12.) stay behind.
    for (const wallet of chosenWallets) {
      await this.derived.sync(userId, result.projectId, wallet);
    }
    await this.projectNotifications?.filesChanged(userId, result.projectId);
    return { projectId: result.projectId };
  }
}

// --- F4.4: take files over from another project ---

export interface TakeOverSource {
  readonly projectId: string;
  readonly name: string;
  readonly taxYear: number;
  readonly status: Project['status'];
  readonly files: readonly (FileOption & { readonly inTarget: boolean })[];
}

export class GetTakeOverSourcesQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(GetTakeOverSourcesQuery)
export class GetTakeOverSourcesHandler implements IQueryHandler<
  GetTakeOverSourcesQuery,
  TakeOverSource[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: GetTakeOverSourcesQuery): Promise<TakeOverSource[]> {
    const target = await loadOwnProject(this.projects, userId, projectId);
    const inTarget = new Set(
      (await this.files.listByProject(target.id)).map((f) => f.fileId),
    );
    const out: TakeOverSource[] = [];
    for (const project of await this.projects.findByOwner(userId)) {
      if (project.id === target.id) continue;
      const files = await this.files.listByProject(project.id);
      if (files.length === 0) continue;
      out.push({
        projectId: project.id,
        name: project.name,
        taxYear: project.taxYear,
        status: project.status,
        files: files
          .map((f) => ({
            projectFileId: f.id,
            displayName: f.displayName,
            platform: f.platform,
            status: f.status,
            periodFrom: f.period?.from ?? null,
            periodTo: f.period?.to ?? null,
            preselected: false,
            inTarget: inTarget.has(f.fileId),
          }))
          .sort(
            (a, b) =>
              compareText(a.platform ?? '', b.platform ?? '') ||
              compareText(a.displayName, b.displayName),
          ),
      });
    }
    return out;
  }
}

export class TakeOverFilesCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileIds: readonly string[],
  ) {}
}

/**
 * F4.4: links files of other projects into this one — the same stored file (no second BLOB),
 * read the same way, origin "aus Projekt X". Files already in the project are skipped.
 */
@CommandHandler(TakeOverFilesCommand)
export class TakeOverFilesHandler implements ICommandHandler<
  TakeOverFilesCommand,
  { added: number; skipped: number }
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly bundles: ProjectBundleRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileIds,
  }: TakeOverFilesCommand): Promise<{ added: number; skipped: number }> {
    const target = await loadOwnProject(this.projects, userId, projectId);
    if (target.status === 'closed') {
      throw projectClosed(
        'The project is closed: reopen it first, then change its files',
      );
    }
    const ids = [...new Set(projectFileIds)];
    if (ids.length === 0) throw new BadRequestException('Choose files');
    const present = new Set(
      (await this.files.listByProject(target.id)).map((f) => f.fileId),
    );
    const sourceNames = new Map<string, string>();
    const chosen: ProjectFile[] = [];
    let skipped = 0;
    for (const id of ids) {
      const file = await this.files.findById(id);
      if (!file || file.projectId === target.id) {
        throw new NotFoundException('No such file');
      }
      if (!sourceNames.has(file.projectId)) {
        const owner = await this.projects.findById(file.projectId);
        if (!owner || owner.ownerId !== userId) {
          throw new NotFoundException('No such file');
        }
        sourceNames.set(file.projectId, owner.name);
      }
      if (present.has(file.fileId)) {
        skipped += 1;
        continue;
      }
      present.add(file.fileId);
      chosen.push(file);
    }
    if (chosen.length === 0) return { added: 0, skipped };
    const mappingIds = [
      ...new Set(chosen.flatMap((f) => (f.mappingId ? [f.mappingId] : []))),
    ];
    await this.bundles.write(userId, {
      target: { existingProjectId: target.id },
      mappings: mappingIds.map((id) => ({ key: id, existingId: id })),
      files: chosen.map((f) => ({
        key: f.id,
        stored: { existingId: f.fileId },
        displayName: f.displayName,
        origin: `${FROM_PROJECT}${f.projectId}`,
        analysis: f,
        mappingKey: f.mappingId,
      })),
      corrections: [],
      rates: [],
      openItemStates: [],
      exports: [],
      carryovers: chosen.map((f) => ({
        sourceProjectId: f.projectId,
        sourceProjectName: sourceNames.get(f.projectId) ?? '',
        kind: 'file' as const,
        refFileKey: f.id,
        label: f.displayName,
        data: { sourceProjectFileId: f.id },
      })),
    });
    await this.projectNotifications?.filesChanged(userId, target.id);
    return { added: chosen.length, skipped };
  }
}

// --- What a project took over ---

export interface CarryoverView extends Carryover {
  /** Open items: ticked off in this project. */
  readonly done: boolean | null;
  readonly note: string | null;
}

export class ListCarryoversQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(ListCarryoversQuery)
export class ListCarryoversHandler implements IQueryHandler<
  ListCarryoversQuery,
  CarryoverView[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly carryovers: CarryoverRepositoryPort,
    private readonly states: OpenItemStateRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListCarryoversQuery): Promise<CarryoverView[]> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const states = new Map(
      (await this.states.listByProject(project.id)).map((s) => [s.itemKey, s]),
    );
    return (await this.carryovers.listByProject(project.id)).map((c) => {
      if (c.kind !== 'open_item') return { ...c, done: null, note: null };
      const state = states.get(`${CARRIED_PREFIX}${c.id}`);
      return {
        ...c,
        done: state?.done ?? false,
        note: state?.note ?? String(c.data['note'] ?? ''),
      };
    });
  }
}
