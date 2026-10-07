import { createHash, randomBytes } from 'node:crypto';

/**
 * A personal access token for the MCP endpoint (F11.16): shown once at creation, stored only as
 * its SHA-256. Scope = MCP only — the rest of the API never accepts it.
 */
export interface McpToken {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenHint: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface NewMcpToken {
  readonly name: string;
  readonly tokenHash: string;
  readonly tokenHint: string;
  readonly expiresAt: string | null;
}

/** Every token starts with it, so the guard can tell a PAT from a Firebase ID token. */
export const MCP_TOKEN_PREFIX = 'lkmcp_';

/** 32 random bytes, base64url — 256 bits; the hash is enough to find it again. */
export function generateMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The last four characters, to recognise a token in the list. */
export function mcpTokenHint(token: string): string {
  return `…${token.slice(-4)}`;
}

export function looksLikeMcpToken(token: string | undefined): boolean {
  return (
    typeof token === 'string' &&
    token.startsWith(MCP_TOKEN_PREFIX) &&
    token.length > MCP_TOKEN_PREFIX.length + 20
  );
}

export type McpTokenState = 'active' | 'expired' | 'revoked';

export function tokenState(token: McpToken, now: Date): McpTokenState {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'active';
}
