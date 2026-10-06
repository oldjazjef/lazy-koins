import type { OpenItem, WalletState } from './types';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * F8.1 "Wallets auf allen Netzwerken geprüft" (FACHREGELN: same EVM address on every chain; only
 * spam there → note it). Per wallet of the project:
 *
 * - red: the address was used on a network that is not selected for it, or a selected/used
 *   network has neither fetched data nor (where nothing can be fetched) a manual balance;
 * - yellow: the network check (F6.4) has not run, a fetch failed, or a network that only
 *   delivers income still needs its balance at 31.12. by hand.
 *
 * Keys are stable per wallet, network and reason (ticks survive recalculations).
 */
export function walletCheckItems(wallets: readonly WalletState[]): OpenItem[] {
  const items: OpenItem[] = [];
  const item = (
    wallet: WalletState,
    network: string | null,
    reason: OpenItem['reason'],
    light: 'yellow' | 'red',
  ): OpenItem => ({
    key: `walletNetworks:${wallet.walletId}|${network ?? '*'}|${reason}`,
    check: 'walletNetworks',
    reason,
    light,
    platform: wallet.label,
    accountId: network,
    asset: null,
    date: null,
    params: { wallet: wallet.label, network: network ?? '' },
    impactChf: null,
    recordIds: [],
  });
  const sorted = [...wallets].sort(
    (a, b) =>
      compareText(a.label, b.label) || compareText(a.walletId, b.walletId),
  );
  for (const wallet of sorted) {
    if (!wallet.networksChecked) {
      items.push(item(wallet, null, 'walletNetworksUnchecked', 'yellow'));
    }
    const networks = [...wallet.networks].sort((a, b) =>
      compareText(a.network, b.network),
    );
    for (const state of networks) {
      if (!state.selected) {
        if (state.used === true) {
          items.push(
            item(wallet, state.network, 'walletNetworkNotSelected', 'red'),
          );
        }
        continue;
      }
      if (state.used === false && state.fetch !== 'error') continue;
      if (state.fetch === 'error') {
        items.push(item(wallet, state.network, 'walletFetchFailed', 'yellow'));
      }
      if (state.coverage === 'history') {
        if (state.fetch === 'none' && !state.manualBalance) {
          items.push(
            item(wallet, state.network, 'walletNetworkNotFetched', 'red'),
          );
        }
        continue;
      }
      // Income only / manual: the balance at 31.12. needs a manual entry with evidence (F6.5).
      if (!state.manualBalance) {
        items.push(
          item(
            wallet,
            state.network,
            'walletManualBalanceMissing',
            state.used === true ? 'red' : 'yellow',
          ),
        );
      }
      if (
        state.coverage === 'income' &&
        state.fetch === 'none' &&
        state.used === true
      ) {
        items.push(
          item(wallet, state.network, 'walletNetworkNotFetched', 'yellow'),
        );
      }
    }
  }
  return items;
}
