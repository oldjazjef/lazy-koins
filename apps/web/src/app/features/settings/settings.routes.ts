import type { Routes } from '@angular/router';
import { desktopOnly } from '../../core/desktop/desktop-bridge';

const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./settings-shell').then((m) => m.SettingsShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'ai' },
      {
        path: 'ai',
        loadComponent: () =>
          import('./pages/ai-settings-page/ai-settings-page').then(
            (m) => m.AiSettingsPage,
          ),
      },
      {
        // Desktop app only (F3.1): the data folder. In the browser the route does not exist.
        path: 'storage',
        canMatch: [desktopOnly],
        loadComponent: () =>
          import('./pages/storage-settings-page/storage-settings-page').then(
            (m) => m.StorageSettingsPage,
          ),
      },
    ],
  },
];

export default routes;
