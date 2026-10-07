import { chRules } from '../rules/country-rules';
import { calculate } from './calculate';
import type { WalletNetworkState, WalletState } from './types';
import { walletCheckItems } from './wallet-check';

function net(over: Partial<WalletNetworkState>): WalletNetworkState {
  return {
    network: 'ethereum',
    selected: true,
    used: true,
    coverage: 'history',
    fetch: 'ok',
    manualBalance: false,
    ...over,
  };
}

function wallet(over: Partial<WalletState>): WalletState {
  return {
    walletId: 'w1',
    label: 'Ledger',
    networksChecked: true,
    networks: [net({})],
    ...over,
  };
}

function lightOf(wallets: WalletState[]) {
  return calculate({
    taxYear: 2025,
    rules: chRules,
    bookings: [],
    holdings: [],
    corrections: [],
    rates: [],
    wallets,
  }).checks.find((c) => c.kind === 'walletNetworks')?.light;
}

describe('wallet check (F6.4, F8.1)', () => {
  it('is green when every used network is fetched and the check ran', () => {
    expect(
      lightOf([
        wallet({
          networks: [
            net({}),
            net({ network: 'polygon', used: false, fetch: 'none' }),
            net({ network: 'base', selected: false, used: false }),
          ],
        }),
      ]),
    ).toBe('green');
  });

  it('is grey without wallets', () => {
    expect(lightOf([])).toBe('grey');
  });

  it('is red for a used network that is not included or not fetched', () => {
    const items = walletCheckItems([
      wallet({
        networks: [
          net({ fetch: 'none' }),
          net({ network: 'base', selected: false, used: true }),
        ],
      }),
    ]);
    expect(items.map((i) => [i.reason, i.light, i.accountId])).toEqual([
      ['walletNetworkNotSelected', 'red', 'base'],
      ['walletNetworkNotFetched', 'red', 'ethereum'],
    ]);
    expect(items[0]?.key).toBe(
      'walletNetworks:w1|base|walletNetworkNotSelected',
    );
  });

  it('is yellow when the check has not run or a fetch failed', () => {
    const items = walletCheckItems([
      wallet({ networksChecked: false, networks: [net({ fetch: 'error' })] }),
    ]);
    expect(items.map((i) => [i.reason, i.light])).toEqual([
      ['walletNetworksUnchecked', 'yellow'],
      ['walletFetchFailed', 'yellow'],
    ]);
  });

  it('asks for a manual balance where only income (or nothing) can be fetched (F6.5)', () => {
    expect(
      walletCheckItems([
        wallet({
          networks: [net({ network: 'cardano', coverage: 'income' })],
        }),
      ]).map((i) => [i.reason, i.light]),
    ).toEqual([['walletManualBalanceMissing', 'red']]);
    expect(
      walletCheckItems([
        wallet({
          networks: [
            net({
              network: 'cosmos',
              coverage: 'manual',
              fetch: 'none',
              manualBalance: true,
            }),
          ],
        }),
      ]),
    ).toEqual([]);
    expect(
      walletCheckItems([
        wallet({
          networks: [
            net({ network: 'ethereum', fetch: 'none', manualBalance: true }),
          ],
        }),
      ]),
    ).toEqual([]);
  });
});
