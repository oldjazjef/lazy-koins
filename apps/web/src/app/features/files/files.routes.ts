import type { Routes } from '@angular/router';

/** F5.21–F5.23: every file of mine, independent of projects. */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/my-files-page/my-files-page').then((m) => m.MyFilesPage),
  },
];

export default routes;
