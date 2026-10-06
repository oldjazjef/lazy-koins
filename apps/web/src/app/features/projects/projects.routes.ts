import type { Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/projects-page/projects-page').then((m) => m.ProjectsPage),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./pages/project-form-page/project-form-page').then(
        (m) => m.ProjectFormPage,
      ),
  },
  {
    path: ':id/follow-up',
    loadComponent: () =>
      import('./pages/follow-up-page/follow-up-page').then(
        (m) => m.FollowUpPage,
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/project-detail-page/project-detail-page').then(
        (m) => m.ProjectDetailPage,
      ),
  },
];

export default routes;
