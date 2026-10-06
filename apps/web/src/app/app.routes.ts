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
      { path: '', pathMatch: 'full', redirectTo: 'projects' },
      {
        path: 'projects',
        loadChildren: () => import('./features/projects/projects.routes'),
      },
    ],
  },
  { path: '**', redirectTo: 'app' },
];
