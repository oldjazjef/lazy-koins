import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, resolveDataDir } from './storage';

/**
 * F11.16 on the desktop: the API listens on 127.0.0.1 and a port the OS picks per start, so the
 * app writes where its MCP endpoint is into the data folder; the stdio proxy
 * (`src/mcp/stdio-proxy.ts`, `mcp-stdio.js` in the bundle) reads it. Pure helpers — no Electron.
 */
export const MCP_ENDPOINT_FILE = 'mcp-endpoint.json';

export interface McpEndpointInfo {
  /** `http://127.0.0.1:<port>/api/mcp` */
  readonly url: string;
  /** The desktop app's process — a stale file of a crashed run is recognised by it. */
  readonly pid: number;
}

const LOOPBACK_MCP = /^http:\/\/127\.0\.0\.1:\d{1,5}\/api\/mcp$/;

export function writeMcpEndpoint(dataDir: string, info: McpEndpointInfo): void {
  const target = join(dataDir, MCP_ENDPOINT_FILE);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(info)}\n`, 'utf8');
  renameSync(temp, target);
}

/** Only our own file is removed (another instance may have written it since). */
export function removeMcpEndpoint(dataDir: string, pid: number): void {
  const current = readMcpEndpoint(dataDir);
  if (current && current.pid !== pid) return;
  rmSync(join(dataDir, MCP_ENDPOINT_FILE), { force: true });
}

/** The recorded endpoint; `null` when missing, unreadable or not a loopback MCP URL. */
export function readMcpEndpoint(dataDir: string): McpEndpointInfo | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(dataDir, MCP_ENDPOINT_FILE), 'utf8'),
    ) as Record<string, unknown>;
    const url = raw['url'];
    const pid = raw['pid'];
    if (typeof url !== 'string' || !LOOPBACK_MCP.test(url)) return null;
    if (typeof pid !== 'number' || !Number.isInteger(pid)) return null;
    return { url, pid };
  } catch {
    return null;
  }
}

/**
 * Electron's `userData` of the packaged app (`app.getPath('appData')/lazy-koins`), computed
 * without Electron: Windows `%APPDATA%`, macOS `~/Library/Application Support`, Linux
 * `$XDG_CONFIG_HOME` or `~/.config`.
 */
export function packagedUserData(
  platform: string,
  env: Record<string, string | undefined>,
  home: string,
  appName = 'lazy-koins',
): string {
  if (platform === 'win32') {
    return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), appName);
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', appName);
  }
  return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), appName);
}

/**
 * Where the stdio proxy finds the endpoint: `LAZYKOINS_MCP_URL` (any loopback MCP URL, for
 * tests), else the endpoint file in `LAZYKOINS_DATA_DIR`, else in the data folder the packaged
 * app uses (its desktop-config.json, `LK_DATA_DIR`, or `<userData>/data`).
 */
export function resolveMcpEndpoint(
  env: Record<string, string | undefined>,
  platform: string,
  home: string,
): { url: string | null; dataDir: string | null } {
  const explicit = env['LAZYKOINS_MCP_URL']?.trim();
  if (explicit) {
    return {
      url: LOOPBACK_MCP.test(explicit) ? explicit : null,
      dataDir: null,
    };
  }
  const dataDir =
    env['LAZYKOINS_DATA_DIR']?.trim() ||
    (() => {
      const userData = packagedUserData(platform, env, home);
      return resolveDataDir(userData, readConfig(userData), env);
    })();
  return { url: readMcpEndpoint(dataDir)?.url ?? null, dataDir };
}
