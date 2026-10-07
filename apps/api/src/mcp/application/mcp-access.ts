import { Injectable, Optional } from '@nestjs/common';
import {
  PinLockState,
  PinRuntime,
  PinSessions,
} from '../../pin/application/pin-sessions';
import { defaultAssistantSettings } from '../../assistant/domain/assistant-settings';
import { AssistantSettingsRepositoryPort } from '../../assistant/ports/assistant.repository.port';
import {
  hashMcpToken,
  looksLikeMcpToken,
  tokenState,
} from '../domain/mcp-token';
import { McpTokenRepositoryPort } from '../ports/mcp-token.repository.port';
import type { McpPrincipal } from './mcp-server';

/** Why a request to `/api/mcp` is refused — HTTP status + a stable code. */
export class McpAccessError extends Error {
  constructor(
    readonly status: 401 | 403 | 423 | 429,
    readonly code:
      | 'pinLocked'
      | 'missingToken'
      | 'invalidToken'
      | 'tokenRevoked'
      | 'tokenExpired'
      | 'mcpDisabled'
      | 'rateLimited',
    message: string,
  ) {
    super(message);
    this.name = 'McpAccessError';
  }
}

/** `lastUsedAt` is written at most once a minute per token. */
const TOUCH_INTERVAL_MS = 60_000;

/** Requests per token and minute (F11.16 "Rate limits per token"). */
export const MCP_REQUESTS_PER_MINUTE = 120;

/**
 * Authenticates MCP requests with a personal access token (F11.16) — separate from Firebase and
 * valid for MCP only: SHA-256 lookup, revoked/expired refused, the owner's MCP switch must be on.
 * Also keeps a per-token request budget (fixed one-minute windows, in memory).
 */
@Injectable()
export class McpAccess {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(
    private readonly tokens: McpTokenRepositoryPort,
    private readonly settings: AssistantSettingsRepositoryPort,
    // F11.0p: absent in specs that do not care about the PIN lock.
    @Optional() private readonly pinRuntime?: PinRuntime,
    @Optional() private readonly pinState?: PinLockState,
    @Optional() private readonly pinSessions?: PinSessions,
  ) {}

  async authenticate(
    authorization: string | undefined,
    now = new Date(),
  ): Promise<McpPrincipal> {
    const [scheme, token, ...rest] = (authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token || rest.length > 0) {
      throw new McpAccessError(
        401,
        'missingToken',
        'Send a personal access token: Authorization: Bearer lkmcp_…',
      );
    }
    if (!looksLikeMcpToken(token)) {
      throw new McpAccessError(401, 'invalidToken', 'Unknown token');
    }
    const stored = await this.tokens.findByHash(hashMcpToken(token));
    if (!stored) throw new McpAccessError(401, 'invalidToken', 'Unknown token');
    const state = tokenState(stored, now);
    if (state === 'revoked') {
      throw new McpAccessError(401, 'tokenRevoked', 'The token was revoked');
    }
    if (state === 'expired') {
      throw new McpAccessError(401, 'tokenExpired', 'The token has expired');
    }
    const settings =
      (await this.settings.find(stored.userId)) ??
      defaultAssistantSettings(stored.userId);
    if (!settings.mcpEnabled) {
      throw new McpAccessError(
        403,
        'mcpDisabled',
        'The MCP server is switched off for this account (Einstellungen › MCP)',
      );
    }
    await this.checkPinLock(stored.userId);
    this.take(stored.id, now.getTime());
    if (
      !stored.lastUsedAt ||
      now.getTime() - new Date(stored.lastUsedAt).getTime() > TOUCH_INTERVAL_MS
    ) {
      await this.tokens.touch(stored.id, now.toISOString());
    }
    return {
      userId: stored.userId,
      tokenId: stored.id,
      policy: {
        areas: settings.mcpAreas,
        allowWrite: settings.mcpAllowWrite,
      },
    };
  }

  /**
   * F11.0p × F11.16 (decided 08.10.2026): on the **desktop** an MCP token is refused (423
   * `pinLocked`) while the app is locked — a user with a PIN must have the app unlocked, and MCP
   * traffic never renews the unlock (the auto-lock still runs). On the **web** the token is its
   * own credential (scoped to MCP, hashed, with expiry, revocable), so the PIN lock of the
   * browser sessions does not apply to it.
   */
  private async checkPinLock(userId: string): Promise<void> {
    if (
      !this.pinRuntime ||
      this.pinRuntime.mode !== 'desktop' ||
      !this.pinState ||
      !this.pinSessions
    ) {
      return;
    }
    if (!(await this.pinState.pinOf(userId))) return;
    if (this.pinSessions.isUnlocked(userId)) return;
    throw new McpAccessError(
      423,
      'pinLocked',
      'lazy-koins is locked: unlock it with the PIN in the desktop app first',
    );
  }

  private take(tokenId: string, now: number): void {
    const window = this.windows.get(tokenId);
    if (!window || now - window.start >= 60_000) {
      this.windows.set(tokenId, { start: now, count: 1 });
      if (this.windows.size > 10_000) this.prune(now);
      return;
    }
    window.count += 1;
    if (window.count > MCP_REQUESTS_PER_MINUTE) {
      throw new McpAccessError(
        429,
        'rateLimited',
        `At most ${MCP_REQUESTS_PER_MINUTE} requests per minute per token`,
      );
    }
  }

  private prune(now: number): void {
    for (const [id, window] of this.windows) {
      if (now - window.start >= 60_000) this.windows.delete(id);
    }
  }
}
