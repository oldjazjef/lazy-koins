import { UnprocessableEntityException } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  type AddressKind,
  classifyAddress,
  detectSecret,
  isNetworkId,
  type NetworkId,
  networkInfo,
  networksForAddress,
  type SecretKind,
  type TokenVerdict,
  tokenVerdicts,
} from '@lazykoins/engine';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  checkWalletInput,
  type NetworkCheckResult,
  type Wallet,
  type WalletInputProblem,
} from '../domain/wallet';
import {
  ChainDataError,
  ChainDataSourcesPort,
} from '../ports/chain-data.port';
import { WalletRepositoryPort } from '../ports/wallet.repository.port';
import { ChainGate, walletConflict } from './chain-gate';
import { loadOwnWallet } from './wallet-access';
import { WalletDerivedFiles } from './wallet-derived-files';
import { type WalletView, WalletViews } from './wallet-views';

/**
 * F6.2: the 422 for a refused input. It names the KIND of secret only — never the input, a word
 * of it, its length or position — and nothing is logged.
 */
export function inputProblem(
  problem: WalletInputProblem,
): UnprocessableEntityException {
  const messages: Record<WalletInputProblem['code'], string> = {
    secretRefused:
      'This looks like a seed phrase or a private key. It was not stored. Never enter secrets — only the public address.',
    unknownAddress: 'Not a supported public address',
    labelRequired: 'A label is required',
    networkNotForAddress: 'The address cannot be used on this network',
  };
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message: messages[problem.code],
    code: problem.code,
    ...(problem.code === 'secretRefused' ? { kind: problem.kind } : {}),
    ...(problem.code === 'networkNotForAddress' && isNetworkId(problem.network)
      ? { network: problem.network }
      : {}),
  });
}

export interface WalletInput {
  readonly label: string;
  readonly address: string;
  readonly networks?: readonly string[];
  readonly notes?: string;
}

export class ListWalletsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(ListWalletsQuery)
export class ListWalletsHandler implements IQueryHandler<
  ListWalletsQuery,
  WalletView[]
> {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly views: WalletViews,
  ) {}

  async execute({ userId }: ListWalletsQuery): Promise<WalletView[]> {
    return this.views.of(await this.wallets.listByOwner(userId));
  }
}

export class GetWalletQuery {
  constructor(
    readonly userId: string,
    readonly walletId: string,
  ) {}
}

@QueryHandler(GetWalletQuery)
export class GetWalletHandler implements IQueryHandler<
  GetWalletQuery,
  WalletView
> {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly views: WalletViews,
  ) {}

  async execute({ userId, walletId }: GetWalletQuery): Promise<WalletView> {
    return this.views.one(await loadOwnWallet(this.wallets, userId, walletId));
  }
}

/** F6.1/F6.2/F6.4 before saving: what the address is and where it can live — nothing stored. */
export interface AddressInspection {
  readonly addressKind: AddressKind | null;
  readonly networks: readonly NetworkId[];
  readonly secret: SecretKind | null;
}

export function inspectAddress(address: string): AddressInspection {
  const secret = detectSecret(address);
  if (secret) return { addressKind: null, networks: [], secret };
  const kind = classifyAddress(address);
  return {
    addressKind: kind ?? null,
    networks: kind ? networksForAddress(kind) : [],
    secret: null,
  };
}

export class CreateWalletCommand {
  constructor(
    readonly userId: string,
    readonly input: WalletInput,
  ) {}
}

/** F6.1, F6.2: refuses secrets before anything else; networks default to all possible ones. */
@CommandHandler(CreateWalletCommand)
export class CreateWalletHandler implements ICommandHandler<
  CreateWalletCommand,
  WalletView
> {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly views: WalletViews,
  ) {}

  async execute({ userId, input }: CreateWalletCommand): Promise<WalletView> {
    const checked = checkWalletInput(input);
    if (!checked.ok) throw inputProblem(checked.problem);
    const wallet = await this.wallets.create({
      ownerId: userId,
      label: input.label.trim(),
      address: input.address.trim(),
      addressKind: checked.addressKind,
      networks: checked.networks ?? networksForAddress(checked.addressKind),
      notes: (input.notes ?? '').trim(),
    });
    return this.views.one(wallet);
  }
}

export class UpdateWalletCommand {
  constructor(
    readonly userId: string,
    readonly walletId: string,
    readonly changes: {
      readonly label?: string;
      readonly networks?: readonly string[];
      readonly notes?: string;
    },
  ) {}
}

/** Label, networks, notes (the address stays — a new address is a new wallet). */
@CommandHandler(UpdateWalletCommand)
export class UpdateWalletHandler implements ICommandHandler<
  UpdateWalletCommand,
  WalletView
> {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly views: WalletViews,
    private readonly derived: WalletDerivedFiles,
  ) {}

  async execute({
    userId,
    walletId,
    changes,
  }: UpdateWalletCommand): Promise<WalletView> {
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    const checked = checkWalletInput({
      label: changes.label ?? wallet.label,
      notes: changes.notes,
      networks: changes.networks,
      addressKind: wallet.addressKind,
    });
    if (!checked.ok) throw inputProblem(checked.problem);
    const updated = await this.wallets.update(wallet.id, {
      label: changes.label?.trim(),
      notes: changes.notes?.trim(),
      networks: checked.networks,
    });
    if (!updated) throw new Error('unreachable');
    // The label is the platform and the networks decide the rows: refresh derived files.
    await this.derived.syncAll(userId, updated);
    return this.views.one(updated);
  }
}

export class DeleteWalletCommand {
  constructor(
    readonly userId: string,
    readonly walletId: string,
  ) {}
}

/**
 * Deletes the wallet and its derived files in open projects. A closed project that includes it
 * blocks the delete (F4.5: its statement must stay reproducible) — 409 `usedByClosedProject`.
 */
@CommandHandler(DeleteWalletCommand)
export class DeleteWalletHandler implements ICommandHandler<
  DeleteWalletCommand,
  void
> {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly derived: WalletDerivedFiles,
  ) {}

  async execute({ userId, walletId }: DeleteWalletCommand): Promise<void> {
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    for (const projectId of await this.wallets.listProjectIds(wallet.id)) {
      const project = await this.projects.findById(projectId);
      if (project?.status === 'closed') {
        throw walletConflict(
          'usedByClosedProject',
          'A closed project includes this wallet',
        );
      }
    }
    await this.derived.removeAll(userId, wallet);
    await this.wallets.delete(wallet.id);
  }
}

export class CheckNetworksCommand {
  constructor(
    readonly userId: string,
    readonly walletId: string,
  ) {}
}

/**
 * F6.4 "Netzwerke prüfen": asks every network the address can live on whether it was used
 * (EVM: the same address on all six chains). Per-network failures are recorded, not thrown — a
 * chain that is not on the user's plan must not hide the others.
 */
@CommandHandler(CheckNetworksCommand)
export class CheckNetworksHandler implements ICommandHandler<
  CheckNetworksCommand,
  WalletView
> {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly gate: ChainGate,
    private readonly sources: ChainDataSourcesPort,
    private readonly views: WalletViews,
  ) {}

  async execute({ userId, walletId }: CheckNetworksCommand): Promise<WalletView> {
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    await this.gate.assertOnline(userId);
    const connection = await this.gate.connection(userId);
    const results: NetworkCheckResult[] = [];
    for (const network of networksForAddress(wallet.addressKind)) {
      const adapter = this.sources.forFamily(networkInfo(network).family);
      try {
        const activity = await adapter.activity(
          connection,
          network,
          wallet.address,
        );
        results.push({
          network,
          used: activity.used,
          txCount: activity.txCount,
          errorCode: null,
          detail: null,
        });
      } catch (error) {
        if (!(error instanceof ChainDataError)) throw error;
        results.push({
          network,
          used: null,
          txCount: null,
          errorCode: error.code,
          detail: error.detail,
        });
      }
    }
    await this.wallets.saveNetworkCheck(wallet.id, {
      checkedAt: new Date().toISOString(),
      results,
    });
    const updated = await loadOwnWallet(this.wallets, userId, walletId);
    return this.views.one(updated);
  }
}

export class FetchWalletCommand {
  constructor(
    readonly userId: string,
    readonly walletId: string,
  ) {}
}

/**
 * F6.3 "Abrufen": the history of every selected network (explicit action, never inside the
 * calculation; F11.3 respected), stored per network; a failed network keeps its previous
 * movements and records the error. Then every open project that includes the wallet gets its
 * derived files refreshed.
 */
@CommandHandler(FetchWalletCommand)
export class FetchWalletHandler implements ICommandHandler<
  FetchWalletCommand,
  WalletView
> {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly gate: ChainGate,
    private readonly sources: ChainDataSourcesPort,
    private readonly derived: WalletDerivedFiles,
    private readonly views: WalletViews,
  ) {}

  async execute({ userId, walletId }: FetchWalletCommand): Promise<WalletView> {
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    await this.gate.assertOnline(userId);
    const connection = await this.gate.connection(userId);
    const previous = await this.wallets.listData([wallet.id]);
    for (const network of wallet.networks) {
      const adapter = this.sources.forFamily(networkInfo(network).family);
      const fetchedAt = new Date().toISOString();
      try {
        const history = await adapter.history(
          connection,
          network,
          wallet.address,
        );
        await this.wallets.saveData({
          walletId: wallet.id,
          network,
          status: 'ok',
          errorCode: null,
          errorDetail: null,
          movements: history.movements,
          info: history.info,
          fetchedAt,
        });
      } catch (error) {
        if (!(error instanceof ChainDataError)) throw error;
        const old = previous.find((d) => d.network === network);
        await this.wallets.saveData({
          walletId: wallet.id,
          network,
          status: 'error',
          errorCode: error.code,
          errorDetail: error.detail,
          movements: old?.movements ?? [],
          info: old?.info ?? {},
          fetchedAt,
        });
      }
    }
    await this.derived.syncAll(userId, wallet);
    return this.views.one(wallet);
  }
}

export interface NetworkTokens {
  readonly network: NetworkId;
  readonly tokens: readonly TokenVerdict[];
}

export class ListWalletTokensQuery {
  constructor(
    readonly userId: string,
    readonly walletId: string,
  ) {}
}

/** F6.6: the tokens seen per network with the spam verdict, its reasons and the override. */
@QueryHandler(ListWalletTokensQuery)
export class ListWalletTokensHandler implements IQueryHandler<
  ListWalletTokensQuery,
  NetworkTokens[]
> {
  constructor(private readonly wallets: WalletRepositoryPort) {}

  async execute({
    userId,
    walletId,
  }: ListWalletTokensQuery): Promise<NetworkTokens[]> {
    const wallet = await loadOwnWallet(this.wallets, userId, walletId);
    const data = await this.wallets.listData([wallet.id]);
    const overrides = await this.wallets.listOverrides(wallet.id);
    return data.map((d) => ({
      network: d.network,
      tokens: tokenVerdicts(
        d.movements,
        networkInfo(d.network).nativeAsset,
        new Set(
          overrides.filter((o) => o.network === d.network).map((o) => o.tokenKey),
        ),
      ).filter((t) => t.tokenKey !== 'native'),
    }));
  }
}

export class SetTokenOverrideCommand {
  constructor(
    readonly userId: string,
    readonly walletId: string,
    readonly network: NetworkId,
    readonly tokenKey: string,
    readonly notSpam: boolean,
  ) {}
}

/** F6.6 "kein Spam" (or back to the heuristics); derived files follow. */
@CommandHandler(SetTokenOverrideCommand)
export class SetTokenOverrideHandler implements ICommandHandler<
  SetTokenOverrideCommand,
  NetworkTokens[]
> {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly derived: WalletDerivedFiles,
    private readonly tokens: ListWalletTokensHandler,
  ) {}

  async execute(command: SetTokenOverrideCommand): Promise<NetworkTokens[]> {
    const wallet: Wallet = await loadOwnWallet(
      this.wallets,
      command.userId,
      command.walletId,
    );
    await this.wallets.setOverride(
      wallet.id,
      command.network,
      command.tokenKey,
      command.notSpam,
    );
    await this.derived.syncAll(command.userId, wallet);
    return this.tokens.execute(
      new ListWalletTokensQuery(command.userId, command.walletId),
    );
  }
}
