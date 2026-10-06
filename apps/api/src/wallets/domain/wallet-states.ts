import {
  networkInfo,
  networksForAddress,
  type WalletState,
} from '@lazykoins/engine';
import type {
  Wallet,
  WalletManualBalance,
  WalletNetworkData,
} from './wallet';

/**
 * The calculation's view of a project's wallets (F6.4 → F8.1 "Wallets auf allen Netzwerken
 * geprüft"): per wallet and every network its address can live on — selected?, used?, fetched?,
 * manual balance at the project's 31.12.? Pure; sorted, so it can go into the input hash.
 */
export function walletStates(
  wallets: readonly Wallet[],
  data: readonly WalletNetworkData[],
  balances: readonly WalletManualBalance[],
  yearEnd: string,
): WalletState[] {
  return [...wallets]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((wallet) => {
      const possible = networksForAddress(wallet.addressKind);
      const check = wallet.networkCheck;
      const checked = new Set(
        (check?.results ?? [])
          .filter((r) => r.used !== null)
          .map((r) => r.network),
      );
      return {
        walletId: wallet.id,
        label: wallet.label,
        networksChecked: possible.every((network) => checked.has(network)),
        networks: possible.map((network) => {
          const fetched = data.find(
            (d) => d.walletId === wallet.id && d.network === network,
          );
          const result = check?.results.find((r) => r.network === network);
          const fetchedOk = fetched?.status === 'ok';
          return {
            network,
            selected: wallet.networks.includes(network),
            // A fetch that found movements proves use even without a check.
            used:
              result?.used ??
              (fetchedOk && (fetched?.movements.length ?? 0) > 0 ? true : null),
            coverage: networkInfo(network).coverage,
            fetch: !fetched ? 'none' : fetched.status === 'ok' ? 'ok' : 'error',
            manualBalance: balances.some(
              (b) =>
                b.walletId === wallet.id &&
                b.network === network &&
                b.asOf === yearEnd &&
                b.evidenceFileId !== null,
            ),
          };
        }),
      };
    });
}
