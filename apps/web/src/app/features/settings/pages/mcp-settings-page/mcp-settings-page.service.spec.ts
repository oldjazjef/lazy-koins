import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  AuditEntry,
  McpSettings,
  McpToken,
} from '../../../../core/api/assistant.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import {
  McpSettingsPageService,
  mcpSnippets,
  TOKEN_PLACEHOLDER,
} from './mcp-settings-page.service';

const ENDPOINT = 'https://lazykoins.example/api/mcp';

const settings = (over: Partial<McpSettings> = {}): McpSettings => ({
  enabled: false,
  areas: [],
  allowWrite: false,
  endpoint: ENDPOINT,
  mode: 'web',
  tools: [],
  ...over,
});

const token = (over: Partial<McpToken> = {}): McpToken => ({
  id: 't1',
  name: 'Laptop',
  hint: '…abcd',
  state: 'active',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  ...over,
});

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'a1',
  userId: 'u1',
  source: 'mcp',
  tool: 'list_projects',
  args: '{}',
  status: 'ok',
  errorCode: null,
  durationMs: 12,
  tokenId: 't1',
  createdAt: '2026-10-07T10:00:00.000Z',
  ...over,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const isAudit = (request: { url: string }) =>
  request.url === '/api/settings/mcp/audit';

async function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      McpSettingsPageService,
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(McpSettingsPageService);
  const http = TestBed.inject(HttpTestingController);
  await settle();
  http.expectOne('/api/settings/mcp').flush(settings());
  http.expectOne('/api/settings/mcp/tokens').flush([token()]);
  const audit: TestRequest = http.expectOne(isAudit);
  expect(audit.request.params.get('limit')).toBe('200');
  expect(audit.request.params.has('source')).toBe(false);
  audit.flush([entry()]);
  await settle();
  return { service, http, notifications };
}

describe('McpSettingsPageService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('saves on/off, areas and writing', async () => {
    const { service, http, notifications } = await setup();
    const saved = service.save({
      enabled: true,
      areas: ['projects', 'results'],
      allowWrite: false,
    });
    const request = http.expectOne('/api/settings/mcp');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      enabled: true,
      areas: ['projects', 'results'],
      allowWrite: false,
    });
    request.flush(settings({ enabled: true, areas: ['projects', 'results'] }));
    expect(await saved).toBe(true);
    expect(service.settings.value()?.enabled).toBe(true);
    expect(notifications.success).toHaveBeenCalledWith('mcp.saved');
  });

  it('shows a new token once and puts it into the snippets', async () => {
    const { service, http } = await setup();
    expect(service.snippets()?.claudeCode).toContain(TOKEN_PLACEHOLDER);

    const created = service.createToken({ name: 'Laptop', expiresInDays: 90 });
    const request = http.expectOne('/api/settings/mcp/tokens');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Laptop', expiresInDays: 90 });
    request.flush({ token: 'lkm_secret', info: token({ id: 't2' }) });
    expect(await created).toBe(true);
    expect(service.createdToken()?.token).toBe('lkm_secret');
    expect(service.snippets()?.claudeCode).toContain(
      'Authorization: Bearer lkm_secret',
    );
    await settle();
    http
      .expectOne('/api/settings/mcp/tokens')
      .flush([token(), token({ id: 't2' })]);
  });

  it('revokes a token and forgets it when it was the new one', async () => {
    const { service, http } = await setup();
    service.createdToken.set({ token: 'lkm_secret', info: token() });
    const revoked = service.revokeToken(token());
    const request = http.expectOne('/api/settings/mcp/tokens/t1');
    expect(request.request.method).toBe('DELETE');
    request.flush(token({ state: 'revoked' }));
    await revoked;
    expect(service.createdToken()).toBeNull();
    await settle();
    http
      .expectOne('/api/settings/mcp/tokens')
      .flush([token({ state: 'revoked' })]);
  });

  it('filters the audit log by source', async () => {
    const { service, http } = await setup();
    service.auditSource.set('chat');
    await settle();
    const request = http.expectOne(isAudit);
    expect(request.request.params.get('source')).toBe('chat');
    request.flush([entry({ source: 'chat' })]);
    await settle();
    expect(service.audit.value()?.[0]?.source).toBe('chat');
  });
});

describe('mcpSnippets', () => {
  it('builds the client configurations', () => {
    const snippets = mcpSnippets(ENDPOINT, 'TKN', null);
    expect(JSON.parse(snippets.claudeDesktop)).toEqual({
      mcpServers: {
        'lazy-koins': {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            ENDPOINT,
            '--header',
            'Authorization:Bearer TKN',
          ],
        },
      },
    });
    expect(snippets.claudeCode).toBe(
      `claude mcp add --transport http lazy-koins ${ENDPOINT} --header "Authorization: Bearer TKN"`,
    );
    expect(snippets.stdio).toBeNull();
  });

  it('adds the token to the desktop stdio server', () => {
    const snippets = mcpSnippets(ENDPOINT, 'TKN', {
      command: '/Applications/lazy-koins.app/lazy-koins',
      args: ['--mcp-stdio'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(JSON.parse(snippets.stdio ?? '')).toEqual({
      mcpServers: {
        'lazy-koins': {
          command: '/Applications/lazy-koins.app/lazy-koins',
          args: ['--mcp-stdio'],
          env: { ELECTRON_RUN_AS_NODE: '1', LAZYKOINS_MCP_TOKEN: 'TKN' },
        },
      },
    });
  });
});
