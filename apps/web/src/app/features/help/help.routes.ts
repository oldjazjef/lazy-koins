import type { Routes } from '@angular/router';

/** F11.21: the step-by-step guide (`/app/help#<section>`), also reachable during the setup wizard. */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/help-page/help-page').then((m) => m.HelpPage),
  },
];

export default routes;
