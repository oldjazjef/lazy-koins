import { join } from 'node:path';
import { DATABASE_FILE } from './storage';

/**
 * The environment the in-process API boots with (validated by apps/api/src/config/env.ts).
 * `AUTH_MODE=local` + `LOCAL_MODE=true`: one local user, no token, and the API binds 127.0.0.1
 * only. `LK_IGNORE_ENV_FILE` keeps a stray `.env` in the working directory out.
 */
export function desktopApiEnv(options: {
  dataDir: string;
  encryptionKey: string;
}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    AUTH_MODE: 'local',
    LOCAL_MODE: 'true',
    LOCAL_USER_EMAIL: 'local@lazykoins.local',
    DATABASE_URL: `file:${join(options.dataDir, DATABASE_FILE)}`,
    SETTINGS_ENCRYPTION_KEY: options.encryptionKey,
    // The window talks to the API through the app:// proxy, never cross-origin.
    CORS_ORIGINS: '',
    API_DOCS: 'false',
    TRUST_PROXY_HOPS: '0',
    LK_IGNORE_ENV_FILE: 'true',
  };
}
