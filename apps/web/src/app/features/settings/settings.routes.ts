import type { Routes } from '@angular/router';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'ai' },
  {
    path: 'ai',
    loadComponent: () =>
      import('./pages/ai-settings-page/ai-settings-page').then(
        (m) => m.AiSettingsPage,
      ),
  },
];

export default routes;
