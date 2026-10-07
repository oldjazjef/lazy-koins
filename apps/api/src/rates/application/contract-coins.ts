import { Injectable, Logger } from '@nestjs/common';
import type { Project } from '../../projects/domain/project';
import type { WalletNetworkData } from '../../wallets/domain/wallet';
import { WalletRepositoryPort } from '../../wallets/ports/wallet.repository.port';
import {
  COINGECKO_PLATFORMS,
  type CoinChoice,
  type CoinContract,
  CONTRACT_PATTERN,
} from '../domain/coin-choice';
import { CoinChoiceService } from './coin-choice.service';

/**
 * Asset (upper case) → the one token contract the project's wallets hold it under (F6 data,
 * `ChainMovement.tokenId`). Only networks CoinGecko has a platform for; an asset seen under
 * **several** contracts (another chain, a fake token with the same symbol) is left out — a clean
 * identification or none. Native coins (`tokenId` null) are never contracts.
 */
export function walletContracts(
  data: readonly WalletNetworkData[],
): Map<string, CoinContract> {
  const seen = new Map<string, Set<string>>();
  for (const network of data) {
    if (!COINGECKO_PLATFORMS[network.network]) continue;
    for (const m of network.movements) {
      if (!m.tokenId || m.type === 'failed') continue;
      const address =
        network.network === 'solana' ? m.tokenId : m.tokenId.toLowerCase();
      if (!CONTRACT_PATTERN.test(address)) continue;
      const asset = m.asset.toUpperCase();
      const keys = seen.get(asset) ?? new Set<string>();
      keys.add(`${network.network}|${address}`);
      seen.set(asset, keys);
    }
  }
  const out = new Map<string, CoinContract>();
  for (const [asset, keys] of [...seen].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (keys.size !== 1) continue;
    const [network = '', address = ''] = [...keys][0]?.split('|') ?? [];
    out.set(asset, { network, address });
  }
  return out;
}

/** A coin identified by its contract during "Kurse aktualisieren". */
export interface ContractCoin {
  readonly asset: string;
  readonly choice: CoinChoice;
}

/**
 * F7.4 + F6: identifies a wallet token by chain + contract (CoinGecko
 * `GET /coins/{platform}/contract/{address}`) instead of by its ticker, and stores the result as
 * the user's coin for that ticker (`CoinChoice.contract` says how it was found) — so the price
 * comes from that coin only and no shared-ticker warning is needed. Asked only for the tickers the
 * caller names (ambiguous or shared ones) and only on the explicit refresh (online, F11.3). A
 * provider failure or an unlisted contract leaves the asset as it was (never fails the refresh);
 * a coin whose symbol is not the asset's is not taken (a contract of another token).
 */
@Injectable()
export class ContractCoinResolver {
  private readonly logger = new Logger(ContractCoinResolver.name);

  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly coins: CoinChoiceService,
  ) {}

  async resolve(
    project: Project,
    wanted: readonly string[],
    apiKey: string | undefined,
  ): Promise<ContractCoin[]> {
    if (wanted.length === 0) return [];
    const ids = await this.wallets.listWalletIds(project.id);
    if (ids.length === 0) return [];
    const own = (await this.wallets.findByIds(ids))
      .filter((w) => w.ownerId === project.ownerId)
      .map((w) => w.id);
    const contracts = walletContracts(await this.wallets.listData(own));
    const out: ContractCoin[] = [];
    for (const asset of [
      ...new Set(wanted.map((a) => a.toUpperCase())),
    ].sort()) {
      const contract = contracts.get(asset);
      if (!contract) continue;
      const platform = COINGECKO_PLATFORMS[contract.network];
      if (!platform) continue;
      try {
        const coin = await this.coins.directory.byContract(
          'coingecko',
          platform,
          contract.address,
          { apiKey },
        );
        if (!coin || coin.symbol !== asset) continue;
        const choice: CoinChoice = {
          provider: coin.provider,
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          contract,
        };
        await this.coins.store(project.ownerId, asset, choice);
        out.push({ asset, choice });
      } catch (error) {
        this.logger.warn(
          `contract lookup for ${asset} failed: ${(error as Error).message}`,
        );
      }
    }
    return out;
  }
}
