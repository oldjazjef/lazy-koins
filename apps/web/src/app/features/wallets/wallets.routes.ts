import type { Routes } from '@angular/router';

/** F6: wallets of mine — list, new, and one wallet (edit, network check, fetch, spam). */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/wallets-page/wallets-page').then((m) => m.WalletsPage),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./pages/wallet-page/wallet-page').then((m) => m.WalletPage),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/wallet-page/wallet-page').then((m) => m.WalletPage),
  },
];

export default routes;
