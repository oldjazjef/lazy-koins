import type { NetworkId } from '@lazykoins/engine';
import type {
  ChainSettings,
  ChainSettingsInput,
} from '../domain/chain-settings';
import type {
  NetworkCheck,
  NewManualBalance,
  NewWallet,
  TokenOverride,
  Wallet,
  WalletChanges,
  WalletManualBalance,
  WalletNetworkData,
} from '../domain/wallet';

/**
 * Persistence contract for wallets (F6), their inclusion in projects, fetched data, "kein Spam"
 * overrides and manual balances. Ownership is checked by the handlers. Bound to its Prisma
 * adapter in `PersistenceModule`.
 */
export abstract class WalletRepositoryPort {
  /** The owner's wallets, by label. */
  abstract listByOwner(ownerId: string): Promise<Wallet[]>;
  abstract findById(id: string): Promise<Wallet | undefined>;
  abstract findByIds(ids: readonly string[]): Promise<Wallet[]>;
  abstract create(input: NewWallet): Promise<Wallet>;
  abstract update(
    id: string,
    changes: WalletChanges,
  ): Promise<Wallet | undefined>;
  /** Cascades to project links, fetched data, overrides and manual balances. */
  abstract delete(id: string): Promise<boolean>;
  abstract saveNetworkCheck(id: string, check: NetworkCheck): Promise<void>;

  abstract listData(walletIds: readonly string[]): Promise<WalletNetworkData[]>;
  /** Creates or replaces the wallet's data for that network. */
  abstract saveData(data: WalletNetworkData): Promise<void>;

  abstract listOverrides(walletId: string): Promise<TokenOverride[]>;
  abstract setOverride(
    walletId: string,
    network: NetworkId,
    tokenKey: string,
    notSpam: boolean,
  ): Promise<void>;

  /** Projects that include the wallet. */
  abstract listProjectIds(walletId: string): Promise<string[]>;
  /** Wallets the project includes, oldest link first. */
  abstract listWalletIds(projectId: string): Promise<string[]>;
  abstract addToProject(projectId: string, walletId: string): Promise<void>;
  /** Removes the link and the project's manual balances of that wallet. */
  abstract removeFromProject(projectId: string, walletId: string): Promise<void>;

  abstract listBalances(
    projectId: string,
    walletId?: string,
  ): Promise<WalletManualBalance[]>;
  abstract findBalance(id: string): Promise<WalletManualBalance | undefined>;
  abstract addBalance(input: NewManualBalance): Promise<WalletManualBalance>;
  abstract removeBalance(id: string): Promise<boolean>;
}

/** F6.7: chain lookup settings per user (keys sealed). */
export abstract class ChainSettingsRepositoryPort {
  abstract find(userId: string): Promise<ChainSettings | undefined>;
  abstract save(
    userId: string,
    input: ChainSettingsInput,
  ): Promise<ChainSettings>;
}
