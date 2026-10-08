import type { Routes } from '@angular/router';

/** The account was blocked by a platform admin (403 `accountBlocked`). */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/blocked-page/blocked-page').then((m) => m.BlockedPage),
  },
];

export default routes;
