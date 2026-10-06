import { type App, getApps, initializeApp } from 'firebase-admin/app';

/**
 * The firebase-admin app for a project, created lazily on the first token.
 *
 * Verifying ID tokens needs only the project id: the public signing keys are fetched from
 * Google, no service account is involved. (surf-lend also sends pushes and therefore keeps one
 * app per service account; lazy-koins has no push.)
 */
export function firebaseApp(projectId: string): App {
  const name = `lazykoins-${projectId}`;
  return (
    getApps().find((app) => app.name === name) ??
    initializeApp({ projectId }, name)
  );
}
