import type { Routes } from '@angular/router';

/** The management pages (platform admins, web only; `adminGuard` on the parent route). */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/admin-overview-page/admin-overview-page').then(
        (m) => m.AdminOverviewPage,
      ),
  },
  {
    path: 'users',
    loadComponent: () =>
      import('./pages/admin-users-page/admin-users-page').then(
        (m) => m.AdminUsersPage,
      ),
  },
  {
    path: 'library',
    loadComponent: () =>
      import('./pages/admin-library-page/admin-library-page').then(
        (m) => m.AdminLibraryPage,
      ),
  },
  {
    path: 'audit',
    loadComponent: () =>
      import('./pages/admin-audit-page/admin-audit-page').then(
        (m) => m.AdminAuditPage,
      ),
  },
];

export default routes;
