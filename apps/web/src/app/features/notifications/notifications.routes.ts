import type { Routes } from '@angular/router';

/** F11.11: every notification of mine (the bell's panel shows only the newest). */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/notifications-page/notifications-page').then(
        (m) => m.NotificationsPage,
      ),
  },
];

export default routes;
