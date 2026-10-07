import type { McpToken, NewMcpToken } from '../domain/mcp-token';

/** MCP personal access tokens (hash only). */
export abstract class McpTokenRepositoryPort {
  abstract create(userId: string, token: NewMcpToken): Promise<McpToken>;
  /** Newest first, revoked ones included (the list shows them). */
  abstract listByUser(userId: string): Promise<McpToken[]>;
  abstract findByHash(tokenHash: string): Promise<McpToken | null>;
  abstract findById(id: string): Promise<McpToken | null>;
  abstract revoke(id: string, at: string): Promise<McpToken>;
  abstract touch(id: string, at: string): Promise<void>;
}
