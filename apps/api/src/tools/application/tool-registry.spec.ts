import { describe, expect, it } from 'vitest';
import { summarizeArgs } from '../domain/args-summary';
import { TOOL_AREAS, TOOL_EFFECTS } from '../domain/tool';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { LibraryRuntime } from '../../library/application/library-runtime';
import { LibraryService } from '../../library/library.service';
import { PLANTED_SECRETS, toolSetup } from '../testing/tool-fixture';
import { ToolRegistry } from './tool-registry';

const ALL_OPEN = { areas: [...TOOL_AREAS], allowWrite: true };
const READ_ONLY = { areas: [...TOOL_AREAS], allowWrite: false };

describe('tool registry (F11.14, F11.16)', () => {
  it('declares every tool with a valid name, an area, an effect and object schemas', async () => {
    const { registry } = await toolSetup();
    const tools = registry.all();
    expect(tools.length).toBeGreaterThan(30);
    const names = new Set<string>();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(names.has(tool.name)).toBe(false);
      names.add(tool.name);
      expect([...TOOL_AREAS, 'ui']).toContain(tool.area);
      expect(TOOL_EFFECTS).toContain(tool.effect);
      expect(tool.description.length).toBeGreaterThan(20);
      const { input, output } = registry.schemaOf(tool);
      expect(input['type']).toBe('object');
      expect(output['type']).toBe('object');
      expect(input['$schema']).toBeUndefined();
    }
  });

  it('registers the mapping-library tools only where the library exists (web, F5.15)', async () => {
    const { registry, services, bus } = await toolSetup();
    const LIBRARY = [
      'search_library',
      'get_library_mapping',
      'take_library_mapping',
      'rate_library_mapping',
      'publish_mapping',
      'delete_library_mapping',
    ];
    for (const name of LIBRARY) expect(registry.get(name)).toBeDefined();
    expect(registry.get('delete_library_mapping')?.effect).toBe('destructive');
    const desktop = ToolRegistry.over({
      ...services,
      library: new LibraryService(
        bus as unknown as CommandBus,
        bus as unknown as QueryBus,
        new LibraryRuntime(false),
      ),
    });
    for (const name of LIBRARY) expect(desktop.get(name)).toBeUndefined();
  });

  it('marks reading tools readOnly and changing tools write/destructive', async () => {
    const { registry } = await toolSetup();
    const effect = (name: string) => registry.get(name)?.effect;
    for (const name of [
      'list_projects',
      'get_result',
      'list_positions',
      'get_figure_records',
      'get_checks',
      'list_rates',
      'get_settings',
    ]) {
      expect(effect(name), name).toBe('readOnly');
    }
    for (const name of [
      'set_price_override',
      'calculate_project',
      'set_hint_status',
      'create_export',
      'update_settings',
    ]) {
      expect(effect(name), name).toBe('write');
    }
    for (const name of [
      'delete_project',
      'remove_file',
      'delete_mapping',
      'send_mail',
    ]) {
      expect(effect(name), name).toBe('destructive');
    }
  });

  it('keeps chat-only (ui) tools out of MCP and the byte upload out of the chat', async () => {
    const { registry } = await toolSetup();
    const chat = registry.forChat().map((t) => t.name);
    const mcp = registry.forMcp(ALL_OPEN).map((t) => t.name);
    expect(chat).toContain('request_file_upload');
    expect(chat).toContain('navigate');
    expect(chat).not.toContain('upload_file');
    expect(mcp).toContain('upload_file');
    expect(mcp).not.toContain('request_file_upload');
    expect(mcp).not.toContain('navigate');
  });

  it('filters MCP tools by area and the write switch', async () => {
    const { registry } = await toolSetup();
    const readOnly = registry.forMcp(READ_ONLY);
    expect(readOnly.every((t) => t.effect === 'readOnly')).toBe(true);
    const onlyResults = registry.forMcp({
      areas: ['results'],
      allowWrite: true,
    });
    expect(new Set(onlyResults.map((t) => t.area))).toEqual(
      new Set(['results']),
    );
  });

  it('runs a read tool for the acting user and audits it', async () => {
    const { executor, audit, project } = await toolSetup();
    const result = await executor.call(
      { userId: 'anna', source: 'mcp', tokenId: 'token-1' },
      'list_projects',
      {},
      { policy: READ_ONLY },
    );
    expect(result.ok).toBe(true);
    const output = (
      result as { output: { projects: { id: string; link: string }[] } }
    ).output;
    expect(output.projects.map((p) => p.id)).toEqual([project.id]);
    expect(output.projects[0]?.link).toBe(`/app/projects/${project.id}`);
    // F4.1a: amounts carry the project's tax currency.
    expect(output.projects[0]).toMatchObject({ currency: 'CHF' });
    expect(audit.rows).toEqual([
      expect.objectContaining({
        userId: 'anna',
        source: 'mcp',
        tool: 'list_projects',
        status: 'ok',
        tokenId: 'token-1',
        errorCode: null,
      }),
    ]);
  });

  it('scopes every tool to the owner: someone else’s project is not found', async () => {
    const { executor, project } = await toolSetup();
    const result = await executor.call(
      { userId: 'mallory', source: 'mcp' },
      'get_project',
      { projectId: project.id },
      { policy: READ_ONLY },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toEqual(
      expect.objectContaining({ code: 'notFound', status: 404 }),
    );
    const listed = await executor.call(
      { userId: 'mallory', source: 'mcp' },
      'list_projects',
      {},
      { policy: READ_ONLY },
    );
    expect(listed.ok && listed.output).toEqual({ projects: [] });
  });

  it('refuses invalid arguments with the zod issues', async () => {
    const { executor, audit } = await toolSetup();
    const result = await executor.call(
      { userId: 'anna', source: 'mcp' },
      'get_project',
      { projectId: 42 },
      { policy: READ_ONLY },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('invalidArguments');
    expect(audit.rows.at(-1)).toEqual(
      expect.objectContaining({
        status: 'error',
        errorCode: 'invalidArguments',
      }),
    );
  });

  it('refuses write tools over MCP while the switch is off, and areas that are closed', async () => {
    const { executor, audit, project } = await toolSetup();
    const write = await executor.call(
      { userId: 'anna', source: 'mcp' },
      'calculate_project',
      { projectId: project.id },
      { policy: READ_ONLY },
    );
    expect(write.ok ? null : write.error.code).toBe('writeDisabled');
    const area = await executor.call(
      { userId: 'anna', source: 'mcp' },
      'list_projects',
      {},
      { policy: { areas: ['results'], allowWrite: false } },
    );
    expect(area.ok ? null : area.error.code).toBe('areaDisabled');
    expect(audit.rows.map((r) => r.status)).toEqual(['refused', 'refused']);
  });

  it('never runs a chat write tool without the confirmation', async () => {
    const { executor, corrections, project } = await toolSetup();
    const args = {
      projectId: project.id,
      asset: 'DOT',
      date: '2025-12-31',
      priceChf: '4.5',
      reason: 'Kurs laut Kursliste',
    };
    const refused = await executor.call(
      { userId: 'anna', source: 'chat' },
      'set_price_override',
      args,
    );
    expect(refused.ok ? null : refused.error.code).toBe('refused');
    expect(await corrections.listByProject(project.id)).toEqual([]);

    const done = await executor.call(
      { userId: 'anna', source: 'chat' },
      'set_price_override',
      args,
      { confirmed: true },
    );
    expect(done.ok).toBe(true);
    const stored = await corrections.listByProject(project.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.data).toEqual({
      type: 'price_override',
      asset: 'DOT',
      date: '2025-12-31',
      priceChf: '4.5',
    });
  });

  it('keeps closed projects read-only (the service’s 409 becomes a conflict)', async () => {
    const { executor, projects, project } = await toolSetup();
    await projects.update(project.id, { status: 'closed' });
    const result = await executor.call(
      { userId: 'anna', source: 'mcp' },
      'set_price_override',
      {
        projectId: project.id,
        asset: 'DOT',
        date: '2025-12-31',
        priceChf: '4.5',
        reason: 'Kurs laut Kursliste',
      },
      { policy: ALL_OPEN },
    );
    expect(result.ok ? null : result.error).toEqual(
      expect.objectContaining({ code: 'conflict', status: 409 }),
    );
  });

  it('explains a figure: positions with links, drill-down to file and row', async () => {
    const { executor, project } = await toolSetup();
    const ctx = { userId: 'anna', source: 'chat' as const };
    await executor.call(
      ctx,
      'calculate_project',
      { projectId: project.id },
      {
        confirmed: true,
      },
    );
    const positions = await executor.call(ctx, 'list_positions', {
      projectId: project.id,
      asset: 'dot',
    });
    expect(positions.ok).toBe(true);
    expect(positions.ok && positions.output).toMatchObject({
      currency: 'CHF',
    });
    const position = (
      positions as {
        output: {
          positions: { figureId: string; link: string; status: string }[];
        };
      }
    ).output.positions[0];
    expect(position?.status).toBe('missingPrice');
    expect(position?.link).toContain(
      `/app/projects/${project.id}?tab=result&figure=`,
    );

    const records = await executor.call(ctx, 'get_figure_records', {
      projectId: project.id,
      figureId: position?.figureId,
    });
    expect(records.ok).toBe(true);
    const first = (
      records as {
        output: {
          records: {
            fileName: string;
            row: number;
            link: string;
            raw: unknown;
          }[];
        };
      }
    ).output.records[0];
    expect(first).toEqual(
      expect.objectContaining({ fileName: 'bestaende.csv', raw: null }),
    );
    expect(first?.row).toBeGreaterThan(0);
    expect(first?.link).toMatch(/\?tab=files#file-/);
  });

  it('never returns keys, key hints or passwords from the settings tools', async () => {
    const { executor } = await toolSetup();
    const result = await executor.call(
      { userId: 'anna', source: 'mcp' },
      'get_settings',
      {},
      { policy: READ_ONLY },
    );
    expect(result.ok).toBe(true);
    const text = JSON.stringify(result.ok ? result.output : null);
    for (const secret of Object.values(PLANTED_SECRETS)) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/enc:v1|apiKey|password|keys/i);
    expect(result.ok && result.output).toEqual(
      expect.objectContaining({
        ai: {
          enabled: true,
          provider: 'openai_compatible',
          model: 'test-model',
          ready: true,
        },
        mail: { enabled: true, ready: true },
      }),
    );
  });

  it('summarises arguments for the audit without secrets or bulk data', () => {
    const summary = summarizeArgs({
      projectId: 'p1',
      apiKey: 'sk-live-1234567890',
      contentBase64: 'A'.repeat(5000),
      note: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      nested: {
        token: 'secret-token-value',
        hintKey: 'noYearData:kraken|spot',
      },
    });
    expect(summary).not.toContain('sk-live');
    expect(summary).not.toContain('secret-token-value');
    expect(summary).not.toContain('abandon');
    expect(summary).toContain('<5000 chars>');
    expect(summary).toContain('noYearData:kraken|spot');
    expect(summary.length).toBeLessThanOrEqual(500);
  });
});
