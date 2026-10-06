import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  AuditEntry,
  AuditSource,
  CreatedMcpToken,
  CreateMcpTokenRequest,
  McpSettings,
  McpToken,
  SaveMcpSettingsRequest,
} from '../../../../core/api/assistant.types';
import {
  desktopBridge,
  type McpStdioConfig,
} from '../../../../core/desktop/desktop-bridge';
import { NotificationService } from '../../../../core/notifications/notification.service';

/** Stands in for the token in the snippets until one was just created. */
export const TOKEN_PLACEHOLDER = '<TOKEN>';
const SERVER_NAME = 'lazy-koins';
const AUDIT_LIMIT = 200;
const KEY = 'mcp-settings';

export interface McpSnippets {
  readonly claudeDesktop: string;
  readonly claudeCode: string;
  readonly http: string;
  /** Desktop app only: the stdio server, when the desktop shell can describe it. */
  readonly stdio: string | null;
}

/** Ready-to-paste client configurations for the endpoint (and the desktop's stdio server). */
export function mcpSnippets(
  endpoint: string,
  token: string,
  stdio: McpStdioConfig | null,
): McpSnippets {
  const header = `Authorization: Bearer ${token}`;
  return {
    claudeDesktop: JSON.stringify(
      {
        mcpServers: {
          [SERVER_NAME]: {
            command: 'npx',
            args: [
              '-y',
              'mcp-remote',
              endpoint,
              '--header',
              `Authorization:Bearer ${token}`,
            ],
          },
        },
      },
      null,
      2,
    ),
    claudeCode: `claude mcp add --transport http ${SERVER_NAME} ${endpoint} --header "${header}"`,
    http: `URL: ${endpoint}\n${header}`,
    stdio: stdio
      ? JSON.stringify(
          {
            mcpServers: {
              [SERVER_NAME]: {
                command: stdio.command,
                args: stdio.args,
                env: { ...stdio.env, LAZYKOINS_MCP_TOKEN: token },
              },
            },
          },
          null,
          2,
        )
      : null,
  };
}

/**
 * Einstellungen › MCP (F11.16): the MCP server on/off, which areas it exposes, whether writing
 * tools are allowed, the access tokens (shown once when created), the client snippets, the tool
 * list and the audit log. Provided by the page, so a freshly created token leaves with it.
 */
@Injectable()
export class McpSettingsPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);

  readonly settings = httpResource<McpSettings>(() => apiUrl('/settings/mcp'));
  readonly tokens = httpResource<McpToken[]>(() =>
    apiUrl('/settings/mcp/tokens'),
  );

  /** '' = both sources. */
  readonly auditSource = signal<AuditSource | ''>('');
  readonly audit = httpResource<AuditEntry[]>(() => {
    const source = this.auditSource();
    return {
      url: apiUrl('/settings/mcp/audit'),
      params: { limit: AUDIT_LIMIT, ...(source ? { source } : {}) },
    };
  });

  /** The token just created — its only appearance; gone with the page. */
  readonly createdToken = signal<CreatedMcpToken | null>(null);
  /** Desktop app: how a client starts the stdio server. */
  readonly stdio = signal<McpStdioConfig | null>(null);

  readonly snippets = computed<McpSnippets | null>(() => {
    if (!this.settings.hasValue()) return null;
    const settings = this.settings.value();
    return mcpSnippets(
      settings.endpoint,
      this.createdToken()?.token ?? TOKEN_PLACEHOLDER,
      settings.mode === 'desktop' ? this.stdio() : null,
    );
  });

  private readonly saveAction = defineAction<
    SaveMcpSettingsRequest,
    McpSettings
  >({
    run: (request) =>
      firstValueFrom(
        this.http.put<McpSettings>(apiUrl('/settings/mcp'), request),
      ),
    messages: { success: 'mcp.saved', error: 'mcp.saveFailed' },
  });

  private readonly createAction = defineAction<
    CreateMcpTokenRequest,
    CreatedMcpToken
  >({
    run: (request) =>
      firstValueFrom(
        this.http.post<CreatedMcpToken>(
          apiUrl('/settings/mcp/tokens'),
          request,
        ),
      ),
    messages: { error: 'mcp.tokens.createFailed' },
  });

  private readonly revokeAction = defineAction<string, McpToken>({
    run: (id) =>
      firstValueFrom(
        this.http.delete<McpToken>(apiUrl(`/settings/mcp/tokens/${id}`)),
      ),
    messages: {
      success: 'mcp.tokens.revoked',
      error: 'mcp.tokens.revokeFailed',
    },
  });

  private readonly status = this.actions.status<unknown>(KEY);
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  async save(request: SaveMcpSettingsRequest): Promise<boolean> {
    try {
      const saved = await this.actions.run(this.saveAction, request, {
        key: KEY,
      });
      this.settings.set(saved);
      return true;
    } catch {
      return false;
    }
  }

  async createToken(request: CreateMcpTokenRequest): Promise<boolean> {
    try {
      const created = await this.actions.run(this.createAction, request, {
        key: KEY,
      });
      this.createdToken.set(created);
      this.tokens.reload();
      return true;
    } catch {
      return false;
    }
  }

  async revokeToken(token: McpToken): Promise<void> {
    try {
      await this.actions.run(this.revokeAction, token.id, { key: KEY });
    } catch {
      return;
    }
    if (this.createdToken()?.info.id === token.id) this.createdToken.set(null);
    this.tokens.reload();
  }

  /** Desktop only: asks the shell how a client starts the stdio server (older shells: no). */
  async loadStdio(): Promise<void> {
    const mcp = desktopBridge()?.mcp;
    if (!mcp) return;
    try {
      this.stdio.set(await mcp.stdio());
    } catch {
      this.stdio.set(null);
    }
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.notifications.success('mcp.copied');
    } catch {
      this.notifications.error('mcp.copyFailed');
    }
  }
}
