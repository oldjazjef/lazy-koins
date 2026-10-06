import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import express from 'express';
import { defaultAssistantSettings } from '../assistant/domain/assistant-settings';
import { InMemoryAssistantSettingsRepository } from '../assistant/testing/in-memory-assistant.repositories';
import { TOOL_AREAS } from '../tools/domain/tool';
import { toolSetup } from '../tools/testing/tool-fixture';
import { McpAccess } from './application/mcp-access';
import {
  CreateMcpTokenCommand,
  CreateMcpTokenHandler,
  ListMcpTokensHandler,
  ListMcpTokensQuery,
  RevokeMcpTokenCommand,
  RevokeMcpTokenHandler,
} from './application/mcp-settings.handlers';
import { hashMcpToken } from './domain/mcp-token';
import { McpController } from './mcp.controller';
import { InMemoryMcpTokenRepository } from './testing/in-memory-mcp-token.repository';

/**
 * F11.16 end to end in-process: the controller behind a real HTTP listener (127.0.0.1, port 0),
 * the official SDK client over Streamable HTTP with a personal access token.
 */
async function mcpSetup() {
  const t = await toolSetup();
  const tokens = new InMemoryMcpTokenRepository();
  const settings = new InMemoryAssistantSettingsRepository();
  const access = new McpAccess(tokens, settings);
  const controller = new McpController(access, t.executor);
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.post('/api/mcp', (req, res, next) => {
    controller.handle(req, res).catch(next);
  });
  app.all('/api/mcp', (_req, res) => controller.notAllowed(res));
  const server: HttpServer = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const url = new URL(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`,
  );
  const create = new CreateMcpTokenHandler(tokens);
  const enable = async (allowWrite: boolean, areas = [...TOOL_AREAS]) => {
    const {
      userId: _id,
      updatedAt: _at,
      ...rest
    } = (await settings.find('anna')) ?? defaultAssistantSettings('anna');
    await settings.save('anna', {
      ...rest,
      mcpEnabled: true,
      mcpAreas: areas,
      mcpAllowWrite: allowWrite,
    });
  };
  const connect = async (token: string) => {
    const client = new Client({ name: 'lazy-koins-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  };
  const clients: Client[] = [];
  const close = async () => {
    await Promise.all(clients.map((c) => c.close()));
    await new Promise((resolve) => server.close(resolve));
  };
  return {
    ...t,
    tokens,
    settings,
    create,
    enable,
    connect,
    clients,
    close,
    url,
  };
}

describe('MCP server (F11.16)', () => {
  let setup: Awaited<ReturnType<typeof mcpSetup>>;
  beforeEach(async () => {
    setup = await mcpSetup();
  });
  afterEach(async () => {
    await setup.close();
  });

  it('lists the tools and calls a read tool with a personal access token', async () => {
    const { create, enable, connect, clients, project, audit, tokens } = setup;
    await enable(false);
    const { token, info } = await create.execute(
      new CreateMcpTokenCommand('anna', 'Claude Desktop', 30),
    );
    expect(token).toMatch(/^lkmcp_/);
    const client = await connect(token);
    clients.push(client);
    expect(client.getServerVersion()?.name).toBe('lazy-koins');

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('list_projects');
    expect(names).toContain('get_figure_records');
    expect(names).not.toContain('set_price_override');
    expect(names).not.toContain('navigate');
    const listProjects = tools.find((tool) => tool.name === 'list_projects');
    expect(listProjects?.annotations).toEqual(
      expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
    );

    const result = await client.callTool({
      name: 'list_projects',
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      projects: [
        expect.objectContaining({ id: project.id, name: 'Steuern 2025' }),
      ],
    });
    expect(audit.rows.at(-1)).toEqual(
      expect.objectContaining({
        source: 'mcp',
        tool: 'list_projects',
        status: 'ok',
        tokenId: info.id,
      }),
    );
    expect((await tokens.findById(info.id))?.lastUsedAt).not.toBeNull();

    const resources = await client.listResources();
    expect(resources.resources[0]?.uri).toBe(
      `lazykoins://projects/${project.id}`,
    );
    const read = await client.readResource({
      uri: `lazykoins://projects/${project.id}`,
    });
    expect(read.contents[0]?.text).toContain('Steuern 2025');
  });

  it('refuses a write tool while "allow write tools" is off, and runs it when on', async () => {
    const { create, enable, connect, clients, project, corrections } = setup;
    await enable(false);
    const { token } = await create.execute(
      new CreateMcpTokenCommand('anna', 'CLI', null),
    );
    const client = await connect(token);
    clients.push(client);
    const args = {
      projectId: project.id,
      asset: 'DOT',
      date: '2025-12-31',
      priceChf: '4.5',
      reason: 'Kurs laut ESTV-Kursliste',
    };
    const refused = await client.callTool({
      name: 'set_price_override',
      arguments: args,
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('writeDisabled');
    expect(await corrections.listByProject(project.id)).toEqual([]);

    await enable(true);
    const done = await client.callTool({
      name: 'set_price_override',
      arguments: args,
    });
    expect(done.isError).toBeFalsy();
    expect(await corrections.listByProject(project.id)).toHaveLength(1);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'delete_project')?.annotations).toEqual(
      expect.objectContaining({ destructiveHint: true, readOnlyHint: false }),
    );
  });

  it('refuses requests without a valid, active token or with MCP switched off', async () => {
    const { create, enable, url, tokens } = setup;
    const post = (authorization?: string) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    expect((await post()).status).toBe(401);
    expect((await post('Bearer dev:anna@lazykoins.dev')).status).toBe(401);
    expect((await post('Bearer lkmcp_unknown_unknown_unknown_xx')).status).toBe(
      401,
    );

    const { token, info } = await create.execute(
      new CreateMcpTokenCommand('anna', 'X', 1),
    );
    // MCP is off by default.
    const off = await post(`Bearer ${token}`);
    expect(off.status).toBe(403);
    expect(
      ((await off.json()) as { error: { data: { code: string } } }).error.data
        .code,
    ).toBe('mcpDisabled');

    await enable(false);
    await new RevokeMcpTokenHandler(tokens).execute(
      new RevokeMcpTokenCommand('anna', info.id),
    );
    const revoked = await post(`Bearer ${token}`);
    expect(revoked.status).toBe(401);
    expect(
      ((await revoked.json()) as { error: { data: { code: string } } }).error
        .data.code,
    ).toBe('tokenRevoked');
  });

  it('refuses an expired token', async () => {
    const { tokens, enable, settings } = setup;
    await enable(false);
    await tokens.create('anna', {
      name: 'old',
      tokenHash: hashMcpToken('lkmcp_expired_expired_expired_x'),
      tokenHint: '…ed_x',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const access = new McpAccess(tokens, settings);
    await expect(
      access.authenticate('Bearer lkmcp_expired_expired_expired_x'),
    ).rejects.toMatchObject({ status: 401, code: 'tokenExpired' });
  });

  it('limits requests per token', async () => {
    const { create, enable, tokens, settings } = setup;
    await enable(false);
    const { token } = await create.execute(
      new CreateMcpTokenCommand('anna', 'Y', null),
    );
    const access = new McpAccess(tokens, settings);
    const now = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 120; i++)
      await access.authenticate(`Bearer ${token}`, now);
    await expect(
      access.authenticate(`Bearer ${token}`, now),
    ).rejects.toMatchObject({
      status: 429,
      code: 'rateLimited',
    });
    await expect(
      access.authenticate(`Bearer ${token}`, new Date('2026-01-01T00:01:01Z')),
    ).resolves.toEqual(expect.objectContaining({ userId: 'anna' }));
  });
});

describe('MCP personal access tokens', () => {
  it('shows the token once and stores only its hash; revoke keeps it listed', async () => {
    const tokens = new InMemoryMcpTokenRepository();
    const created = await new CreateMcpTokenHandler(tokens).execute(
      new CreateMcpTokenCommand('anna', '  Claude Code ', 90),
    );
    const [row] = [...tokens.rows.values()];
    expect(row?.tokenHash).toBe(hashMcpToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(created.info).toEqual(
      expect.objectContaining({
        name: 'Claude Code',
        hint: `…${created.token.slice(-4)}`,
        state: 'active',
      }),
    );
    expect(created.info.expiresAt).not.toBeNull();

    const list = new ListMcpTokensHandler(tokens);
    const listed = await list.execute(new ListMcpTokensQuery('anna'));
    expect(JSON.stringify(listed)).not.toContain(created.token);

    await new RevokeMcpTokenHandler(tokens).execute(
      new RevokeMcpTokenCommand('anna', created.info.id),
    );
    expect((await list.execute(new ListMcpTokensQuery('anna')))[0]?.state).toBe(
      'revoked',
    );
    await expect(
      new RevokeMcpTokenHandler(tokens).execute(
        new RevokeMcpTokenCommand('mallory', created.info.id),
      ),
    ).rejects.toThrow('Token not found');
  });
});
