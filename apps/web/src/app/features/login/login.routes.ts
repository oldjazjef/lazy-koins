import type { Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/login-page/login-page').then((m) => m.LoginPage),
  },
];

export default routes;
