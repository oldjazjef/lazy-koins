import { z } from 'zod';
import {
  type AnyTool,
  defineTool,
  type ToolContext,
  type ToolSource,
} from '../domain/tool';
import {
  identityArguments,
  identityFieldsOf,
  isIdentityField,
  toolContext,
} from '../domain/tool-scope';
import { InMemoryToolAuditRepository } from '../testing/in-memory-tool-audit.repository';
import { toolSetup } from '../testing/tool-fixture';
import { ToolExecutor } from './tool-executor';
import { ToolRegistry } from './tool-registry';

/**
 * F11.16 user scoping: a tool acts for the authenticated user only. No tool may take an argument
 * that names a user, every call gets one frozen context, and arguments that try anyway are
 * refused. The cross-user behaviour of every tool is `tools.isolation.integration.spec.ts`.
 */

function probeTool(
  seen: ToolContext[],
  input: z.ZodType = z.object({ value: z.string().optional() }),
): AnyTool {
  return defineTool({
    name: 'probe_scope',
    title: 'Probe',
    description: 'Records the context it runs with.',
    area: 'projects',
    effect: 'readOnly',
    input,
    output: z.object({ userId: z.string() }),
    run(context) {
      seen.push(context);
      return Promise.resolve({ userId: context.userId });
    },
  });
}

describe('tool input schemas (user scoping)', () => {
  it('no registered tool takes a user / owner / account-holder argument', async () => {
    const { registry } = await toolSetup();
    expect(registry.all().length).toBeGreaterThan(40);
    const offending = registry
      .all()
      .flatMap((tool) =>
        identityFieldsOf(registry.schemaOf(tool).input).map(
          (field) => `${tool.name}.${field}`,
        ),
      );
    expect(offending).toEqual([]);
  });

  it('recognises identity field names, not ordinary ones', () => {
    for (const name of [
      'userId',
      'user_id',
      'USER-ID',
      'user',
      'owner',
      'ownerId',
      'ownerEmail',
      'tenantId',
      'principal',
      'accountHolder',
      'account_holder_id',
      'actorId',
      'subjectId',
      'uid',
      'onBehalfOf',
      'asUser',
    ]) {
      expect(isIdentityField(name), name).toBe(true);
    }
    for (const name of [
      'projectId',
      'accountId',
      'subject',
      'username_hint',
      'mappingId',
      'walletId',
      'to',
      'advisorEmail',
      'displayName',
    ]) {
      expect(isIdentityField(name), name).toBe(false);
    }
  });

  it('finds identity fields nested anywhere in a JSON Schema', () => {
    const schema = z.toJSONSchema(
      z.object({
        projectId: z.string(),
        filter: z.object({ items: z.array(z.object({ ownerId: z.string() })) }),
        either: z.union([z.object({ userId: z.string() }), z.string()]),
      }),
    );
    expect(identityFieldsOf(schema).sort()).toEqual([
      'either.userId',
      'filter.items[].ownerId',
    ]);
  });

  it('the registry refuses to register a tool with an owner argument', () => {
    expect(
      () =>
        new ToolRegistry([
          probeTool(
            [],
            z.object({ projectId: z.string(), ownerId: z.string() }),
          ),
        ]),
    ).toThrow(/must not take a user\/owner argument: ownerId/);
    expect(
      () =>
        new ToolRegistry([
          probeTool(
            [],
            z.object({ nested: z.object({ user_id: z.string() }) }),
          ),
        ]),
    ).toThrow(/nested\.user_id/);
  });
});

describe('ToolExecutor (user scoping guard)', () => {
  function setup() {
    const seen: ToolContext[] = [];
    const audit = new InMemoryToolAuditRepository();
    const executor = new ToolExecutor(
      new ToolRegistry([probeTool(seen)]),
      audit,
    );
    return { seen, audit, executor };
  }

  it('runs the tool with a frozen context of the authenticated user only', async () => {
    const { seen, executor } = setup();
    const authenticated = { userId: 'user-b', source: 'chat' as ToolSource };
    const result = await executor.call(authenticated, 'probe_scope', {});
    expect(result).toEqual(
      expect.objectContaining({ ok: true, output: { userId: 'user-b' } }),
    );
    const [context] = seen;
    expect(Object.isFrozen(context)).toBe(true);
    expect(context).not.toBe(authenticated);
    expect(() => {
      (context as { userId: string }).userId = 'user-a';
    }).toThrow(TypeError);
    // Changing the caller's object afterwards changes nothing the tool saw.
    (authenticated as { userId: string }).userId = 'user-a';
    expect(context?.userId).toBe('user-b');
  });

  it('refuses arguments that name a user — the tool never runs, the refusal is audited', async () => {
    const { seen, audit, executor } = setup();
    for (const args of [
      { userId: 'user-a' },
      { ownerId: 'user-a', value: 'x' },
      { owner_email: 'a@example.ch' },
    ]) {
      const result = await executor.call(
        { userId: 'user-b', source: 'mcp' },
        'probe_scope',
        args,
        { policy: { areas: ['projects'], allowWrite: false } },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('refused');
    }
    expect(seen).toEqual([]);
    expect(audit.rows.map((row) => [row.userId, row.status])).toEqual([
      ['user-b', 'refused'],
      ['user-b', 'refused'],
      ['user-b', 'refused'],
    ]);
  });

  it('the chat proposal path (parse) refuses them too', () => {
    const { executor } = setup();
    const tool = executor.registry.get('probe_scope') as AnyTool;
    expect(() => executor.parse(tool, { userId: 'user-a' })).toThrow(
      /signed-in user/,
    );
  });

  it('identityArguments looks at the top-level keys only (nested data stays data)', () => {
    expect(identityArguments({ userId: 'x', projectId: 'p' })).toEqual([
      'userId',
    ]);
    expect(identityArguments({ spec: { userId: 'column name' } })).toEqual([]);
    expect(identityArguments(null)).toEqual([]);
    expect(identityArguments(['userId'])).toEqual([]);
  });

  it('toolContext refuses a missing user or an unknown source', () => {
    expect(() => toolContext({ userId: '', source: 'chat' })).toThrow();
    expect(() => toolContext({ userId: '  ', source: 'mcp' })).toThrow();
    expect(() =>
      toolContext({ userId: 'u', source: 'web' as unknown as ToolSource }),
    ).toThrow(/Unknown tool source/);
    expect(toolContext({ userId: 'u', source: 'mcp', tokenId: 't' })).toEqual({
      userId: 'u',
      source: 'mcp',
      tokenId: 't',
    });
  });
});
