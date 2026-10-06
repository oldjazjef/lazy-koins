import type { Routes } from '@angular/router';
import { desktopOnly } from '../../core/desktop/desktop-bridge';

/** Einstellungen (ANFORDERUNGEN §11): Kurse, Wallets, AI, System — each section a sub-route. */
const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./settings-shell').then((m) => m.SettingsShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'rates' },
      {
        path: 'rates',
        loadComponent: () =>
          import('./pages/rates-settings-page/rates-settings-page').then(
            (m) => m.RatesSettingsPage,
          ),
      },
      {
        path: 'wallets',
        loadComponent: () =>
          import('./pages/wallet-settings-page/wallet-settings-page').then(
            (m) => m.WalletSettingsPage,
          ),
      },
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
      {
        path: 'system',
        loadComponent: () =>
          import('./pages/system-settings-page/system-settings-page').then(
            (m) => m.SystemSettingsPage,
          ),
      },
    ],
  },
];

export default routes;
