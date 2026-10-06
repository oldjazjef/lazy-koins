import { Injectable } from '@nestjs/common';
import {
  type NetworkCoverage,
  type NetworkId,
  networkInfo,
  networksForAddress,
  tokenVerdicts,
} from '@lazykoins/engine';
import type { ProjectStatus } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import type { FetchInfo, Wallet, WalletNetworkData } from '../domain/wallet';
import { WalletRepositoryPort } from '../ports/wallet.repository.port';

export interface NetworkFetchView {
  readonly network: NetworkId;
  readonly coverage: NetworkCoverage;
  readonly selected: boolean;
  /** F6.4 result; null = not checked (or the check failed). */
  readonly used: boolean | null;
  readonly txCount: number | null;
  readonly checkError: string | null;
  readonly status: 'ok' | 'error' | 'none';
  readonly fetchedAt: string | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly movements: number;
  /** Tokens the heuristics hide as spam (not overridden). */
  readonly spamTokens: number;
  readonly info: FetchInfo;
}

export interface WalletView {
  readonly id: string;
  readonly label: string;
  readonly address: string;
  readonly addressKind: Wallet['addressKind'];
  readonly networks: readonly NetworkId[];
  readonly possibleNetworks: readonly NetworkId[];
  readonly notes: string;
  readonly checkedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly taxYear: number;
    readonly status: ProjectStatus;
  }[];
  readonly perNetwork: readonly NetworkFetchView[];
}

/** Builds what the API shows of wallets: per network the check, the last fetch, spam counts. */
@Injectable()
export class WalletViews {
  constructor(
    private readonly wallets: WalletRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
  ) {}

  async of(wallets: readonly Wallet[]): Promise<WalletView[]> {
    const data = await this.wallets.listData(wallets.map((w) => w.id));
    const out: WalletView[] = [];
    for (const wallet of wallets) {
      const projectIds = await this.wallets.listProjectIds(wallet.id);
      const projects = [];
      for (const id of projectIds) {
        const project = await this.projects.findById(id);
        if (project && project.ownerId === wallet.ownerId) {
          projects.push({
            id: project.id,
            name: project.name,
            taxYear: project.taxYear,
            status: project.status,
          });
        }
      }
      projects.sort((a, b) => b.taxYear - a.taxYear);
      const overrides = await this.wallets.listOverrides(wallet.id);
      out.push({
        id: wallet.id,
        label: wallet.label,
        address: wallet.address,
        addressKind: wallet.addressKind,
        networks: wallet.networks,
        possibleNetworks: networksForAddress(wallet.addressKind),
        notes: wallet.notes,
        checkedAt: wallet.networkCheck?.checkedAt ?? null,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
        projects,
        perNetwork: networksForAddress(wallet.addressKind).map((network) =>
          networkView(
            wallet,
            network,
            data.find((d) => d.walletId === wallet.id && d.network === network),
            new Set(
              overrides
                .filter((o) => o.network === network)
                .map((o) => o.tokenKey),
            ),
          ),
        ),
      });
    }
    return out;
  }

  async one(wallet: Wallet): Promise<WalletView> {
    const [view] = await this.of([wallet]);
    if (!view) throw new Error('unreachable');
    return view;
  }
}

function networkView(
  wallet: Wallet,
  network: NetworkId,
  data: WalletNetworkData | undefined,
  notSpam: ReadonlySet<string>,
): NetworkFetchView {
  const result = wallet.networkCheck?.results.find(
    (r) => r.network === network,
  );
  const info = networkInfo(network);
  return {
    network,
    coverage: info.coverage,
    selected: wallet.networks.includes(network),
    used: result?.used ?? null,
    txCount: result?.txCount ?? null,
    checkError: result?.errorCode ?? null,
    status: data?.status ?? 'none',
    fetchedAt: data?.fetchedAt ?? null,
    errorCode: data?.errorCode ?? null,
    errorDetail: data?.errorDetail ?? null,
    movements: data?.movements.length ?? 0,
    spamTokens: data
      ? tokenVerdicts(data.movements, info.nativeAsset, notSpam).filter(
          (v) => v.spam,
        ).length
      : 0,
    info: data?.info ?? {},
  };
}
