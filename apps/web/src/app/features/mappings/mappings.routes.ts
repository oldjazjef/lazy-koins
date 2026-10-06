import type { Routes } from '@angular/router';

/** F11.0: every mapping of mine, across all projects. */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/mappings-page/mappings-page').then((m) => m.MappingsPage),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/mapping-detail-page/mapping-detail-page').then(
        (m) => m.MappingDetailPage,
      ),
  },
];

export default routes;
