import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { LibraryAvailability } from '../../core/library/library-availability.service';

/** F11.0: every mapping of mine, across all projects; the library (F5.15) is a part of it. */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/mappings-page/mappings-page').then((m) => m.MappingsPage),
  },
  {
    // F5.15–F5.18: the web app's own library, or on the desktop a linked web library — only
    // while it can be used (else back to my mappings).
    path: 'library',
    canMatch: [
      async () => {
        const router = inject(Router);
        return (
          (await inject(LibraryAvailability).canOpen()) ||
          router.parseUrl('/app/mappings')
        );
      },
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
