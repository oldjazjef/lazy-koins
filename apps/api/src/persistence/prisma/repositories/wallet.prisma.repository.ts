import { Injectable } from '@nestjs/common';
import {
  type AddressKind,
  type ChainMovement,
  isNetworkId,
  type NetworkId,
} from '@lazykoins/engine';
import type {
  ChainSettings as ChainSettingsRow,
  Wallet as WalletRow,
  WalletManualBalance as BalanceRow,
  WalletNetworkData as DataRow,
} from '../../../generated/prisma/client';
import type {
  ChainSettings,
  ChainSettingsInput,
} from '../../../wallets/domain/chain-settings';
import type {
  FetchInfo,
  NetworkCheck,
  NewManualBalance,
  NewWallet,
  TokenOverride,
  Wallet,
  WalletChanges,
  WalletManualBalance,
  WalletNetworkData,
} from '../../../wallets/domain/wallet';
import {
  ChainSettingsRepositoryPort,
  WalletRepositoryPort,
} from '../../../wallets/ports/wallet.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function networksOf(text: string): NetworkId[] {
  return parseJson<unknown[]>(text, []).filter(
    (n): n is NetworkId => typeof n === 'string' && isNetworkId(n),
  );
}

function toWallet(row: WalletRow): Wallet {
  return {
    id: row.id,
    ownerId: row.ownerId,
    label: row.label,
    address: row.address,
    addressKind: row.addressKind as AddressKind,
    networks: networksOf(row.networks),
    notes: row.notes,
    networkCheck: parseJson<NetworkCheck | null>(row.networkCheck, null),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toData(row: DataRow): WalletNetworkData {
  return {
    walletId: row.walletId,
    network: row.network as NetworkId,
    status: row.status === 'ok' ? 'ok' : 'error',
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    movements: parseJson<ChainMovement[]>(row.movements, []),
    info: parseJson<FetchInfo>(row.info, {}),
    fetchedAt: toIsoString(row.fetchedAt),
  };
}

function toBalance(row: BalanceRow): WalletManualBalance {
  return {
    id: row.id,
    projectId: row.projectId,
    walletId: row.walletId,
    network: row.network as NetworkId,
    asset: row.asset,
    quantity: row.quantity,
    asOf: row.asOf,
    evidenceFileId: row.evidenceFileId,
    note: row.note,
    createdAt: toIsoString(row.createdAt),
  };
}

@Injectable()
export class WalletPrismaRepository extends WalletRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByOwner(ownerId: string): Promise<Wallet[]> {
    const rows = await this.prisma.wallet.findMany({
      where: { ownerId },
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toWallet);
  }

  async findById(id: string): Promise<Wallet | undefined> {
    const row = await this.prisma.wallet.findUnique({ where: { id } });
    return row ? toWallet(row) : undefined;
  }

  async findByIds(ids: readonly string[]): Promise<Wallet[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.wallet.findMany({
      where: { id: { in: [...ids] } },
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toWallet);
  }

  async create(input: NewWallet): Promise<Wallet> {
    const row = await this.prisma.wallet.create({
      data: {
        ownerId: input.ownerId,
        label: input.label,
        address: input.address,
        addressKind: input.addressKind,
        networks: JSON.stringify(input.networks),
        notes: input.notes,
      },
    });
    return toWallet(row);
  }

  async update(
    id: string,
    changes: WalletChanges,
  ): Promise<Wallet | undefined> {
    const existing = await this.prisma.wallet.findUnique({ where: { id } });
    if (!existing) return undefined;
    const row = await this.prisma.wallet.update({
      where: { id },
      data: {
        label: changes.label,
        notes: changes.notes,
        networks:
          changes.networks === undefined
            ? undefined
            : JSON.stringify(changes.networks),
      },
    });
    return toWallet(row);
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.prisma.wallet.deleteMany({ where: { id } });
    return count > 0;
  }

  async saveNetworkCheck(id: string, check: NetworkCheck): Promise<void> {
    await this.prisma.wallet.update({
      where: { id },
      data: { networkCheck: JSON.stringify(check) },
    });
  }

  async listData(walletIds: readonly string[]): Promise<WalletNetworkData[]> {
    if (walletIds.length === 0) return [];
    const rows = await this.prisma.walletNetworkData.findMany({
      where: { walletId: { in: [...walletIds] } },
      orderBy: [{ walletId: 'asc' }, { network: 'asc' }],
    });
    return rows.map(toData);
  }

  async saveData(data: WalletNetworkData): Promise<void> {
    const values = {
      status: data.status,
      errorCode: data.errorCode,
      errorDetail: data.errorDetail,
      movements: JSON.stringify(data.movements),
      info: JSON.stringify(data.info),
      fetchedAt: new Date(data.fetchedAt),
    };
    await this.prisma.walletNetworkData.upsert({
      where: {
        walletId_network: { walletId: data.walletId, network: data.network },
      },
      create: { walletId: data.walletId, network: data.network, ...values },
      update: values,
    });
  }

  async listOverrides(walletId: string): Promise<TokenOverride[]> {
    const rows = await this.prisma.walletTokenOverride.findMany({
      where: { walletId },
      orderBy: [{ network: 'asc' }, { tokenKey: 'asc' }],
    });
    return rows.map((row) => ({
      network: row.network as NetworkId,
      tokenKey: row.tokenKey,
    }));
  }

  async setOverride(
    walletId: string,
    network: NetworkId,
    tokenKey: string,
    notSpam: boolean,
  ): Promise<void> {
    if (notSpam) {
      await this.prisma.walletTokenOverride.upsert({
        where: { walletId_network_tokenKey: { walletId, network, tokenKey } },
        create: { walletId, network, tokenKey },
        update: {},
      });
    } else {
      await this.prisma.walletTokenOverride.deleteMany({
        where: { walletId, network, tokenKey },
      });
    }
  }

  async listProjectIds(walletId: string): Promise<string[]> {
    const rows = await this.prisma.projectWallet.findMany({
      where: { walletId },
      orderBy: [{ addedAt: 'asc' }, { projectId: 'asc' }],
    });
    return rows.map((row) => row.projectId);
  }

  async listWalletIds(projectId: string): Promise<string[]> {
    const rows = await this.prisma.projectWallet.findMany({
      where: { projectId },
      orderBy: [{ addedAt: 'asc' }, { walletId: 'asc' }],
    });
    return rows.map((row) => row.walletId);
  }

  async addToProject(projectId: string, walletId: string): Promise<void> {
    await this.prisma.projectWallet.upsert({
      where: { projectId_walletId: { projectId, walletId } },
      create: { projectId, walletId },
      update: {},
    });
  }

  async removeFromProject(projectId: string, walletId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.walletManualBalance.deleteMany({
        where: { projectId, walletId },
      }),
      this.prisma.projectWallet.deleteMany({ where: { projectId, walletId } }),
    ]);
  }

  async listBalances(
    projectId: string,
    walletId?: string,
  ): Promise<WalletManualBalance[]> {
    const rows = await this.prisma.walletManualBalance.findMany({
      where: { projectId, ...(walletId ? { walletId } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toBalance);
  }

  async findBalance(id: string): Promise<WalletManualBalance | undefined> {
    const row = await this.prisma.walletManualBalance.findUnique({
      where: { id },
    });
    return row ? toBalance(row) : undefined;
  }

  async addBalance(input: NewManualBalance): Promise<WalletManualBalance> {
    const row = await this.prisma.walletManualBalance.create({
      data: {
        projectId: input.projectId,
        walletId: input.walletId,
        network: input.network,
        asset: input.asset,
        quantity: input.quantity,
        asOf: input.asOf,
        evidenceFileId: input.evidenceFileId,
        note: input.note,
      },
    });
    return toBalance(row);
  }

  async removeBalance(id: string): Promise<boolean> {
    const { count } = await this.prisma.walletManualBalance.deleteMany({
      where: { id },
    });
    return count > 0;
  }
}

function toChainSettings(row: ChainSettingsRow): ChainSettings {
  return {
    userId: row.userId,
    sealedHeliusKey: row.heliusKey,
    solanaRpcUrl: row.solanaRpcUrl,
    sealedSubscanKey: row.subscanKey,
    esploraUrl: row.esploraUrl,
    koiosUrl: row.koiosUrl,
    cosmosLcdUrl: row.cosmosLcdUrl,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class ChainSettingsPrismaRepository extends ChainSettingsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(userId: string): Promise<ChainSettings | undefined> {
    const row = await this.prisma.chainSettings.findUnique({
      where: { userId },
    });
    return row ? toChainSettings(row) : undefined;
  }

  async save(
    userId: string,
    input: ChainSettingsInput,
  ): Promise<ChainSettings> {
    const data = {
      heliusKey: input.sealedHeliusKey,
      subscanKey: input.sealedSubscanKey,
      solanaRpcUrl: input.solanaRpcUrl,
      esploraUrl: input.esploraUrl,
      koiosUrl: input.koiosUrl,
      cosmosLcdUrl: input.cosmosLcdUrl,
    };
    const row = await this.prisma.chainSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data, updatedAt: new Date() },
    });
    return toChainSettings(row);
  }
}
