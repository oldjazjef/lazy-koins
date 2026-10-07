import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { desktopOnly } from '../../core/desktop/desktop-bridge';

/** Einstellungen (ANFORDERUNGEN §11): Kurse, Wallets, AI, Mail, MCP, System — each a sub-route. */
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
      {
        // F11.16: the MCP server for AI clients (Claude Desktop, Claude Code, …).
        path: 'mcp',
        loadComponent: () =>
          import('./pages/mcp-settings-page/mcp-settings-page').then(
            (m) => m.McpSettingsPage,
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
        // Desktop app only (F5.18): the link to a web deployment's mapping library. The web app
        // has its own library — there the route does not exist.
        path: 'library',
        canMatch: [() => !inject(AuthService).hasAccount],
        loadComponent: () =>
          import('./pages/library-settings-page/library-settings-page').then(
            (m) => m.LibrarySettingsPage,
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
