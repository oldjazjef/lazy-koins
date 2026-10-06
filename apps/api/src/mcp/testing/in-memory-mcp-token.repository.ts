import type { McpToken, NewMcpToken } from '../domain/mcp-token';
import { McpTokenRepositoryPort } from '../ports/mcp-token.repository.port';

/** Port double over a Map (the hash kept beside the domain row, as in the table). */
export class InMemoryMcpTokenRepository extends McpTokenRepositoryPort {
  readonly rows = new Map<string, McpToken & { tokenHash: string }>();
  private next = 1;

  async create(userId: string, token: NewMcpToken): Promise<McpToken> {
    const id = `00000000-0000-7000-9000-${String(this.next++).padStart(12, '0')}`;
    const row = {
      id,
      userId,
      name: token.name,
      tokenHint: token.tokenHint,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(id, row);
    return strip(row);
  }

  async listByUser(userId: string): Promise<McpToken[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .reverse()
      .map(strip);
  }

  async findByHash(tokenHash: string): Promise<McpToken | null> {
    const row = [...this.rows.values()].find((r) => r.tokenHash === tokenHash);
    return row ? strip(row) : null;
  }

  async findById(id: string): Promise<McpToken | null> {
    const row = this.rows.get(id);
    return row ? strip(row) : null;
  }

  async revoke(id: string, at: string): Promise<McpToken> {
    const row = this.rows.get(id);
    if (!row) throw new Error('missing token');
    const revoked = { ...row, revokedAt: at };
    this.rows.set(id, revoked);
    return strip(revoked);
  }

  async touch(id: string, at: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastUsedAt: at });
  }
}

function strip(row: McpToken & { tokenHash: string }): McpToken {
  const { tokenHash: _hash, ...token } = row;
  return token;
}
