/**
 * Where the MCP endpoint of this process is reachable. The server knows it from
 * `PUBLIC_API_URL`; the desktop app's API listens on a port the OS picks, so `bootstrap()` records
 * the actual loopback address once it listens (F11.16: desktop = 127.0.0.1 only).
 */
let localEndpoint: string | null = null;

export const MCP_PATH = '/api/mcp';

export function recordLocalMcpEndpoint(baseUrl: string): void {
  localEndpoint = `${baseUrl.replace(/\/+$/, '')}${MCP_PATH}`;
}

export function localMcpEndpoint(): string | null {
  return localEndpoint;
}
