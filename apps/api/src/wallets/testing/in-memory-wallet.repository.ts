import type { NetworkId } from '@lazykoins/engine';
import {
  type ChainSettings,
  type ChainSettingsInput,
  defaultChainSettings,
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
import {
  ChainSettingsRepositoryPort,
  WalletRepositoryPort,
} from '../ports/wallet.repository.port';

/**
 * Port double for handler specs: a real implementation of the contract over Maps. The Prisma
 * adapter is held to the same contract by wallets.persistence.integration.spec.ts.
 */
export class InMemoryWalletRepository extends WalletRepositoryPort {
  readonly wallets = new Map<string, Wallet>();
  readonly data = new Map<string, WalletNetworkData>();
  readonly overrides: { walletId: string; network: NetworkId; tokenKey: string }[] =
    [];
  readonly links: { projectId: string; walletId: string }[] = [];
  readonly balances = new Map<string, WalletManualBalance>();
  private seq = 0;
  private clock = Date.parse('2026-01-01T00:00:00.000Z');

  /** Valid UUIDs, so they pass ParseUUIDPipe in e2e-style specs. */
  private nextId(): string {
    this.seq += 1;
    return `00000000-0000-7000-8000-${String(this.seq).padStart(12, '0')}`;
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  async listByOwner(ownerId: string): Promise<Wallet[]> {
    return [...this.wallets.values()]
      .filter((w) => w.ownerId === ownerId)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }

  async findById(id: string): Promise<Wallet | undefined> {
    return this.wallets.get(id);
  }

  async findByIds(ids: readonly string[]): Promise<Wallet[]> {
    return (await Promise.all(ids.map((id) => this.findById(id))))
      .filter((w): w is Wallet => w !== undefined)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }

  async create(input: NewWallet): Promise<Wallet> {
    const now = this.tick();
    const wallet: Wallet = {
      id: this.nextId(),
      ...input,
      networks: [...input.networks],
      networkCheck: null,
      createdAt: now,
      updatedAt: now,
    };
    this.wallets.set(wallet.id, wallet);
    return wallet;
  }

  async update(
    id: string,
    changes: WalletChanges,
  ): Promise<Wallet | undefined> {
    const wallet = this.wallets.get(id);
    if (!wallet) return undefined;
    const updated: Wallet = {
      ...wallet,
      label: changes.label ?? wallet.label,
      notes: changes.notes ?? wallet.notes,
      networks: changes.networks ? [...changes.networks] : wallet.networks,
      updatedAt: this.tick(),
    };
    this.wallets.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.wallets.delete(id)) return false;
    for (const key of [...this.data.keys()]) {
      if (key.startsWith(`${id}|`)) this.data.delete(key);
    }
    for (let i = this.links.length - 1; i >= 0; i -= 1) {
      if (this.links[i]?.walletId === id) this.links.splice(i, 1);
    }
    for (const [key, balance] of this.balances) {
      if (balance.walletId === id) this.balances.delete(key);
    }
    return true;
  }

  async saveNetworkCheck(id: string, check: NetworkCheck): Promise<void> {
    const wallet = this.wallets.get(id);
    if (wallet) this.wallets.set(id, { ...wallet, networkCheck: check });
  }

  async listData(walletIds: readonly string[]): Promise<WalletNetworkData[]> {
    return [...this.data.values()]
      .filter((d) => walletIds.includes(d.walletId))
      .sort(
        (a, b) =>
          a.walletId.localeCompare(b.walletId) ||
          a.network.localeCompare(b.network),
      );
  }

  async saveData(data: WalletNetworkData): Promise<void> {
    this.data.set(`${data.walletId}|${data.network}`, data);
  }

  async listOverrides(walletId: string): Promise<TokenOverride[]> {
    return this.overrides
      .filter((o) => o.walletId === walletId)
      .map(({ network, tokenKey }) => ({ network, tokenKey }));
  }

  async setOverride(
    walletId: string,
    network: NetworkId,
    tokenKey: string,
    notSpam: boolean,
  ): Promise<void> {
    const index = this.overrides.findIndex(
      (o) =>
        o.walletId === walletId &&
        o.network === network &&
        o.tokenKey === tokenKey,
    );
    if (notSpam && index < 0) this.overrides.push({ walletId, network, tokenKey });
    if (!notSpam && index >= 0) this.overrides.splice(index, 1);
  }

  async listProjectIds(walletId: string): Promise<string[]> {
    return this.links
      .filter((l) => l.walletId === walletId)
      .map((l) => l.projectId);
  }

  async listWalletIds(projectId: string): Promise<string[]> {
    return this.links
      .filter((l) => l.projectId === projectId)
      .map((l) => l.walletId);
  }

  async addToProject(projectId: string, walletId: string): Promise<void> {
    if (
      !this.links.some(
        (l) => l.projectId === projectId && l.walletId === walletId,
      )
    ) {
      this.links.push({ projectId, walletId });
    }
  }

  async removeFromProject(projectId: string, walletId: string): Promise<void> {
    const index = this.links.findIndex(
      (l) => l.projectId === projectId && l.walletId === walletId,
    );
    if (index >= 0) this.links.splice(index, 1);
    for (const [key, balance] of this.balances) {
      if (balance.projectId === projectId && balance.walletId === walletId) {
        this.balances.delete(key);
      }
    }
  }

  async listBalances(
    projectId: string,
    walletId?: string,
  ): Promise<WalletManualBalance[]> {
    return [...this.balances.values()].filter(
      (b) =>
        b.projectId === projectId &&
        (walletId === undefined || b.walletId === walletId),
    );
  }

  async findBalance(id: string): Promise<WalletManualBalance | undefined> {
    return this.balances.get(id);
  }

  async addBalance(input: NewManualBalance): Promise<WalletManualBalance> {
    const balance: WalletManualBalance = {
      ...input,
      id: this.nextId(),
      createdAt: this.tick(),
    };
    this.balances.set(balance.id, balance);
    return balance;
  }

  async removeBalance(id: string): Promise<boolean> {
    return this.balances.delete(id);
  }
}

export class InMemoryChainSettingsRepository extends ChainSettingsRepositoryPort {
  readonly rows = new Map<string, ChainSettings>();

  async find(userId: string): Promise<ChainSettings | undefined> {
    return this.rows.get(userId);
  }

  async save(
    userId: string,
    input: ChainSettingsInput,
  ): Promise<ChainSettings> {
    const current = this.rows.get(userId) ?? defaultChainSettings(userId);
    const next: ChainSettings = {
      ...current,
      sealedHeliusKey:
        input.sealedHeliusKey === undefined
          ? current.sealedHeliusKey
          : input.sealedHeliusKey,
      sealedSubscanKey:
        input.sealedSubscanKey === undefined
          ? current.sealedSubscanKey
          : input.sealedSubscanKey,
      solanaRpcUrl: input.solanaRpcUrl ?? current.solanaRpcUrl,
      esploraUrl: input.esploraUrl ?? current.esploraUrl,
      koiosUrl: input.koiosUrl ?? current.koiosUrl,
      cosmosLcdUrl: input.cosmosLcdUrl ?? current.cosmosLcdUrl,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(userId, next);
    return next;
  }
}
