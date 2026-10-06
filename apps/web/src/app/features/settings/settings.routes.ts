import type { Routes } from '@angular/router';

/** Einstellungen (ANFORDERUNGEN §11): Kurse, Wallets, AI, Mail — each section a sub-route. */
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
        path: 'mail',
        loadComponent: () =>
          import('./pages/mail-settings-page/mail-settings-page').then(
            (m) => m.MailSettingsPage,
          ),
      },
    ],
  },
];

export default routes;
