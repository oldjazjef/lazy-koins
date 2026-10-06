import type { Route } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadChildren: () => import('./features/login/login.routes'),
  },
  {
    // Everything behind sign-in lives under /app, inside the shell with the header.
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/layout/app-shell').then((m) => m.AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadChildren: () => import('./features/dashboard/dashboard.routes'),
      },
      {
        path: 'projects',
        loadChildren: () => import('./features/projects/projects.routes'),
      },
      {
        path: 'mappings',
        loadChildren: () => import('./features/mappings/mappings.routes'),
      },
      {
        path: 'notifications',
        loadChildren: () =>
          import('./features/notifications/notifications.routes'),
      },
      {
        path: 'profile',
        loadChildren: () => import('./features/profile/profile.routes'),
      },
      {
        path: 'settings',
        loadChildren: () => import('./features/settings/settings.routes'),
      },
    ],
  },
  { path: '**', redirectTo: 'app' },
];
