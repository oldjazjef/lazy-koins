import type { Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/dashboard-page/dashboard-page').then(
        (m) => m.DashboardPage,
      ),
  },
];

export default routes;
