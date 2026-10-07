import type { Routes } from '@angular/router';

/** F5.15–F5.17: the mapping library (web only — the route is not matched on the desktop). */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/library-page/library-page').then((m) => m.LibraryPage),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/library-detail-page/library-detail-page').then(
        (m) => m.LibraryDetailPage,
      ),
  },
];

export default routes;
