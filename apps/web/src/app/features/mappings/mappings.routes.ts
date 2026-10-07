import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/** F11.0: every mapping of mine, across all projects; the library (F5.15) is a part of it. */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/mappings-page/mappings-page').then((m) => m.MappingsPage),
  },
  {
    // F5.15–F5.17: the mapping library exists only in the web app, not on the desktop.
    path: 'library',
    canMatch: [
      () =>
        inject(AuthService).hasAccount ||
        inject(Router).parseUrl('/app/mappings'),
    ],
    loadChildren: () => import('../library/library.routes'),
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
