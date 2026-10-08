import type { Routes } from '@angular/router';

/** F9.5: every transaction of mine (all files and wallets), with global edits. */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/transactions-page/transactions-page').then(
        (m) => m.TransactionsPage,
      ),
  },
];

export default routes;
