import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  isNetworkId,
  type NetworkId,
  networksForAddress,
  parseDecimal,
} from '@lazykoins/engine';
import { assertOpen } from '../../files/application/file-access';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  originWalletId,
  type WalletManualBalance,
} from '../domain/wallet';
import { WalletRepositoryPort } from '../ports/wallet.repository.port';
import { loadOwnWallet } from './wallet-access';
import { WalletDerivedFiles } from './wallet-derived-files';
import { type WalletView, WalletViews } from './wallet-views';

export interface ManualBalanceView extends WalletManualBalance {
  readonly evidenceName: string | null;
}

export interface ProjectWalletView {
  readonly wallet: WalletView;
  readonly balances: readonly ManualBalanceView[];
  /** The derived files in the project (F6.3). */
  readonly files: readonly { readonly id: string; readonly displayName: string }[];
}

export interface ProjectWalletsOverview {
  readonly yearEnd: string;
  readonly wallets: readonly ProjectWalletView[];
  /** The owner's other wallets, to add. */
  readonly available: readonly {
    readonly id: string;
    readonly label: string;
    readonly address: string;
  }[];
}

export class ListProjectWalletsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** The project's wallets with fetch status per network, manual balances and derived files. */
@QueryHandler(ListProjectWalletsQuery)
export class ListProjectWalletsHandler implements IQueryHandler<
  ListProjectWalletsQuery,
  ProjectWalletsOverview
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly wallets: WalletRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly views: WalletViews,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListProjectWalletsQuery): Promise<ProjectWalletsOverview> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const ids = await this.wallets.listWalletIds(project.id);
    const included = (await this.wallets.findByIds(ids)).filter(
      (w) => w.ownerId === userId,
    );
    const views = await this.views.of(included);
    const balances = await this.wallets.listBalances(project.id);
    const projectFiles = await this.files.listByProject(project.id);
    const names = new Map(projectFiles.map((f) => [f.id, f.displayName]));
    const all = await this.wallets.listByOwner(userId);
    return {
      yearEnd: `${project.taxYear}-12-31`,
      wallets: views.map((wallet) => ({
        wallet,
        balances: balances
          .filter((b) => b.walletId === wallet.id)
          .map((b) => ({
            ...b,
            evidenceName: b.evidenceFileId
              ? (names.get(b.evidenceFileId) ?? null)
              : null,
          })),
        files: projectFiles
          .filter((f) => originWalletId(f.origin) === wallet.id)
          .map((f) => ({ id: f.id, displayName: f.displayName })),
      })),
      available: all
        .filter((w) => !ids.includes(w.id))
        .map((w) => ({ id: w.id, label: w.label, address: w.address })),
    };
  }
}

export class AddProjectWalletCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly walletId: string,
  ) {}
}

/** Includes a wallet in the project; fetched data (if any) becomes its derived file at once. */
@CommandHandler(AddProjectWalletCommand)
export class AddProjectWalletHandler implements ICommandHandler<
  AddProjectWalletCommand,
  void
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly wallets: WalletRepositoryPort,
    private readonly derived: WalletDerivedFiles,
  ) {}

  async execute({
    userId,
    projectId,
    walletId,
  }: AddProjectWalletCommand): Promise<void> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertOpen(project);
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    await this.wallets.addToProject(project.id, wallet.id);
    await this.derived.sync(userId, project.id, wallet);
  }
}

export class RemoveProjectWalletCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly walletId: string,
  ) {}
}

/** Takes the wallet out of the project: its derived files and manual balances there go too. */
@CommandHandler(RemoveProjectWalletCommand)
export class RemoveProjectWalletHandler implements ICommandHandler<
  RemoveProjectWalletCommand,
  void
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly wallets: WalletRepositoryPort,
    private readonly derived: WalletDerivedFiles,
  ) {}

  async execute({
    userId,
    projectId,
    walletId,
  }: RemoveProjectWalletCommand): Promise<void> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertOpen(project);
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    await this.wallets.removeFromProject(project.id, wallet.id);
    await this.derived.sync(userId, project.id, wallet);
  }
}

export interface ManualBalanceInput {
  readonly network: string;
  readonly asset: string;
  readonly quantity: string;
  /** ISO date; default = the project's 31.12. */
  readonly asOf?: string;
  /** A PDF already uploaded to the project (status evidence only). */
  readonly evidenceFileId: string;
  readonly note?: string;
}

export class AddManualBalanceCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly walletId: string,
    readonly input: ManualBalanceInput,
  ) {}
}

/**
 * F6.5: a balance by hand for a network that cannot be fetched (or only its income), with a
 * receipt — a PDF of the project (evidence only). Becomes a "Bestände" row of the wallet's
 * derived file (a statement balance for that wallet and network).
 */
@CommandHandler(AddManualBalanceCommand)
export class AddManualBalanceHandler implements ICommandHandler<
  AddManualBalanceCommand,
  WalletManualBalance
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly wallets: WalletRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly derived: WalletDerivedFiles,
  ) {}

  async execute({
    userId,
    projectId,
    walletId,
    input,
  }: AddManualBalanceCommand): Promise<WalletManualBalance> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertOpen(project);
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    if (!(await this.wallets.listWalletIds(project.id)).includes(wallet.id)) {
      throw new NotFoundException('The wallet is not part of this project');
    }
    const network = input.network;
    if (
      !isNetworkId(network) ||
      !networksForAddress(wallet.addressKind).includes(network)
    ) {
      throw new BadRequestException('network: not a network of this wallet');
    }
    const asset = input.asset.trim().toUpperCase();
    if (!/^[A-Z0-9.:_-]{1,40}$/.test(asset)) {
      throw new BadRequestException('asset: a symbol like ADA or DOT');
    }
    let quantity: string;
    try {
      const value = parseDecimal(input.quantity);
      if (value.isNegative()) throw new Error('negative');
      quantity = value.toString();
    } catch {
      throw new BadRequestException('quantity: a non-negative decimal number');
    }
    const asOf = input.asOf ?? `${project.taxYear}-12-31`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw new BadRequestException('asOf: an ISO date');
    }
    const evidence = await this.files.findById(input.evidenceFileId);
    if (!evidence || evidence.projectId !== project.id) {
      throw new NotFoundException('No such evidence file in this project');
    }
    if (evidence.status !== 'evidence_only') {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'The receipt must be a PDF of the project',
        code: 'evidenceNotPdf',
      });
    }
    const balance = await this.wallets.addBalance({
      projectId: project.id,
      walletId: wallet.id,
      network: network as NetworkId,
      asset,
      quantity,
      asOf,
      evidenceFileId: evidence.id,
      note: (input.note ?? '').trim().slice(0, 300),
    });
    await this.derived.sync(userId, project.id, wallet);
    return balance;
  }
}

export class RemoveManualBalanceCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly walletId: string,
    readonly balanceId: string,
  ) {}
}

@CommandHandler(RemoveManualBalanceCommand)
export class RemoveManualBalanceHandler implements ICommandHandler<
  RemoveManualBalanceCommand,
  void
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly wallets: WalletRepositoryPort,
    private readonly derived: WalletDerivedFiles,
  ) {}

  async execute({
    userId,
    projectId,
    walletId,
    balanceId,
  }: RemoveManualBalanceCommand): Promise<void> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertOpen(project);
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    const balance = await this.wallets.findBalance(balanceId);
    if (
      !balance ||
      balance.projectId !== project.id ||
      balance.walletId !== wallet.id
    ) {
      throw new NotFoundException('No such balance');
    }
    await this.wallets.removeBalance(balance.id);
    await this.derived.sync(userId, project.id, wallet);
  }
}
