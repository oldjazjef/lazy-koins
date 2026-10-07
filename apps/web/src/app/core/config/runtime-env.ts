/**
 * Runtime configuration, read from `public/env.js` rather than baked into the bundle — the same
 * one-build-many-environments rule as surf-lend and etx-working-time-manager. In the web
 * container the entrypoint rewrites env.js at start (apps/web/entrypoint.sh).
 */

/**
 * `local` = the desktop app (F1.2): no sign-in at all, the API acts as its one local user
 * (`AUTH_MODE=local`). The desktop shell generates its env.js with this mode.
 */
export type AuthMode = 'firebase' | 'dev' | 'local';

/** The web config from Firebase console → Project settings → Your apps. Public by design. */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export interface RuntimeEnv {
  /** Base URL of the API, without `/api`. Empty = same origin (dev-server proxy, nginx). */
  apiBaseUrl: string;
  /** Must match the API's AUTH_MODE. `dev` shows an e-mail field instead of the Firebase sign-in. */
  authMode: AuthMode;
  firebase: FirebaseWebConfig;
  /** Base URL of the Umami instance (`https://stats.…`). Empty disables statistics. */
  umamiUrl: string;
  /** This deployment's website ID in Umami. Empty disables statistics. */
  umamiWebsiteId: string;
}

/**
 * Development values, used per field when env.js is missing or a field is empty, so `pnpm start`
 * works on a fresh checkout. `dev` auth matches apps/api/.env.example.
 */
const DEFAULTS: RuntimeEnv = {
  apiBaseUrl: '',
  authMode: 'dev',
  firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' },
  umamiUrl: '',
  umamiWebsiteId: '',
};

declare global {
  interface Window {
    __LK_ENV__?: Partial<Omit<RuntimeEnv, 'firebase'>> & {
      firebase?: Partial<FirebaseWebConfig>;
    };
  }
}

export function runtimeEnv(): RuntimeEnv {
  const provided = window.__LK_ENV__ ?? {};
  const firebase = provided.firebase ?? {};
  return {
    apiBaseUrl: readString(provided.apiBaseUrl, DEFAULTS.apiBaseUrl).replace(
      /\/+$/,
      '',
    ),
    authMode:
      provided.authMode === 'firebase' || provided.authMode === 'local'
        ? provided.authMode
        : DEFAULTS.authMode,
    firebase: {
      apiKey: readString(firebase.apiKey, DEFAULTS.firebase.apiKey),
      authDomain: readString(firebase.authDomain, DEFAULTS.firebase.authDomain),
      projectId: readString(firebase.projectId, DEFAULTS.firebase.projectId),
      appId: readString(firebase.appId, DEFAULTS.firebase.appId),
    },
    umamiUrl: readString(provided.umamiUrl, DEFAULTS.umamiUrl).replace(
      /\/+$/,
      '',
    ),
    umamiWebsiteId: readString(
      provided.umamiWebsiteId,
      DEFAULTS.umamiWebsiteId,
    ),
  };
}

/** An empty string is what a container writes for a variable that was never passed. */
function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}
