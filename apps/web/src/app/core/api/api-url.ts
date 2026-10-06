import { runtimeEnv } from '../config/runtime-env';

/** `/api/projects` on the same origin (dev-server proxy, nginx), or under `apiBaseUrl`. */
export function apiUrl(path: `/${string}`): string {
  return `${runtimeEnv().apiBaseUrl}/api${path}`;
}

/** Whether a request URL targets our API — the only host the bearer token may go to. */
export function isApiRequest(url: string): boolean {
  const base = `${runtimeEnv().apiBaseUrl}/api/`;
  return url.startsWith(base);
}
