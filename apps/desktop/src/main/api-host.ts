import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { desktopApiEnv } from './lib/api-env';
import { applyMigrations } from './lib/migrations';
import { DATABASE_FILE, ensureSecretKey } from './lib/storage';

/** What `dist/apps/desktop-api/main.js` (apps/api/src/desktop.ts) exports. */
interface ApiBundle {
  DESKTOP_ACCESS_HEADER: string;
  bootstrap(options: {
    port?: number;
    shutdownHooks?: boolean;
    accessToken?: string;
    logger?: string[] | false;
  }): Promise<{
    app: { close(): Promise<void> };
    port: number;
    host: string;
  }>;
}

export interface RunningApi {
  /** `http://127.0.0.1:<port>` */
  baseUrl: string;
  accessHeader: string;
  accessToken: string;
  close(): Promise<void>;
}

/**
 * Brings the database up to date and starts the NestJS API in this process, on 127.0.0.1 and a
 * port the OS picks. Called once per process: the API's ConfigModule reads the environment when
 * its bundle is loaded, so a different data folder means a relaunch (see main.ts), not a restart.
 */
export async function startApi(options: {
  appDir: string;
  dataDir: string;
}): Promise<RunningApi> {
  mkdirSync(options.dataDir, { recursive: true });
  const encryptionKey = ensureSecretKey(options.dataDir);

  const db = new Database(join(options.dataDir, DATABASE_FILE));
  try {
    const applied = applyMigrations(db, join(options.appDir, 'migrations'));
    if (applied.length > 0)
      console.log(`[desktop] migrations applied: ${applied.join(', ')}`);
  } finally {
    db.close();
  }

  Object.assign(
    process.env,
    desktopApiEnv({ dataDir: options.dataDir, encryptionKey }),
  );

  // Loaded only now: its ConfigModule validates process.env at load time.
  const api = require(join(options.appDir, 'api', 'main.js')) as ApiBundle;
  const accessToken = randomBytes(32).toString('hex');
  const running = await api.bootstrap({
    port: 0,
    shutdownHooks: false,
    accessToken,
    logger: ['error', 'warn', 'log'],
  });

  return {
    baseUrl: `http://127.0.0.1:${running.port}`,
    accessHeader: api.DESKTOP_ACCESS_HEADER,
    accessToken,
    close: () => running.app.close(),
  };
}
