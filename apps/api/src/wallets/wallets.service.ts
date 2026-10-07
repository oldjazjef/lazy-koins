import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { NetworkId } from '@lazykoins/engine';
import type { ChainService } from './domain/chain-settings';
import type { WalletManualBalance } from './domain/wallet';
import type { ChainSettingsDraft } from './application/chain-gate';
import {
  type ChainServiceTest,
  type ChainSettingsChanges,
  type ChainSettingsView,
  GetChainSettingsQuery,
  SaveChainSettingsCommand,
  TestChainServiceCommand,
} from './application/chain-settings.handlers';
import {
  AddManualBalanceCommand,
  AddProjectWalletCommand,
  ListProjectWalletsQuery,
  type ManualBalanceInput,
  type ProjectWalletsOverview,
  RemoveManualBalanceCommand,
  RemoveProjectWalletCommand,
} from './application/project-wallets.handlers';
import type { WalletView } from './application/wallet-views';
import {
  CheckNetworksCommand,
  CreateWalletCommand,
  DeleteWalletCommand,
  FetchWalletCommand,
  GetWalletQuery,
  ListWalletsQuery,
  ListWalletTokensQuery,
  type NetworkTokens,
  SetTokenOverrideCommand,
  UpdateWalletCommand,
  type WalletInput,
} from './application/wallets.handlers';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class WalletsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  list(userId: string): Promise<WalletView[]> {
    return this.queries.execute(new ListWalletsQuery(userId));
  }

  get(userId: string, walletId: string): Promise<WalletView> {
    return this.queries.execute(new GetWalletQuery(userId, walletId));
  }

  create(userId: string, input: WalletInput): Promise<WalletView> {
    return this.commands.execute(new CreateWalletCommand(userId, input));
  }

  update(
    userId: string,
    walletId: string,
    changes: UpdateWalletCommand['changes'],
  ): Promise<WalletView> {
    return this.commands.execute(
      new UpdateWalletCommand(userId, walletId, changes),
    );
  }

  delete(userId: string, walletId: string): Promise<void> {
    return this.commands.execute(new DeleteWalletCommand(userId, walletId));
  }

  checkNetworks(userId: string, walletId: string): Promise<WalletView> {
    return this.commands.execute(new CheckNetworksCommand(userId, walletId));
  }

  fetch(userId: string, walletId: string): Promise<WalletView> {
    return this.commands.execute(new FetchWalletCommand(userId, walletId));
  }

  tokens(userId: string, walletId: string): Promise<NetworkTokens[]> {
    return this.queries.execute(new ListWalletTokensQuery(userId, walletId));
  }

  setTokenOverride(
    userId: string,
    walletId: string,
    network: NetworkId,
    tokenKey: string,
    notSpam: boolean,
  ): Promise<NetworkTokens[]> {
    return this.commands.execute(
      new SetTokenOverrideCommand(userId, walletId, network, tokenKey, notSpam),
    );
  }

  projectWallets(
    userId: string,
    projectId: string,
  ): Promise<ProjectWalletsOverview> {
    return this.queries.execute(new ListProjectWalletsQuery(userId, projectId));
  }

  addToProject(
    userId: string,
    projectId: string,
    walletId: string,
  ): Promise<void> {
    return this.commands.execute(
      new AddProjectWalletCommand(userId, projectId, walletId),
    );
  }

  removeFromProject(
    userId: string,
    projectId: string,
    walletId: string,
  ): Promise<void> {
    return this.commands.execute(
      new RemoveProjectWalletCommand(userId, projectId, walletId),
    );
  }

  addBalance(
    userId: string,
    projectId: string,
    walletId: string,
    input: ManualBalanceInput,
  ): Promise<WalletManualBalance> {
    return this.commands.execute(
      new AddManualBalanceCommand(userId, projectId, walletId, input),
    );
  }

  removeBalance(
    userId: string,
    projectId: string,
    walletId: string,
    balanceId: string,
  ): Promise<void> {
    return this.commands.execute(
      new RemoveManualBalanceCommand(userId, projectId, walletId, balanceId),
    );
  }

  settings(userId: string): Promise<ChainSettingsView> {
    return this.queries.execute(new GetChainSettingsQuery(userId));
  }

  saveSettings(
    userId: string,
    changes: ChainSettingsChanges,
  ): Promise<ChainSettingsView> {
    return this.commands.execute(new SaveChainSettingsCommand(userId, changes));
  }

  testService(
    userId: string,
    service: ChainService,
    draft: ChainSettingsDraft,
  ): Promise<ChainServiceTest> {
    return this.commands.execute(
      new TestChainServiceCommand(userId, service, draft),
    );
  }
}
