import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { hashMcpToken } from '../mcp/domain/mcp-token';
import { PrismaService } from './prisma/prisma.service';
import {
  AssistantSettingsPrismaRepository,
  ChatPrismaRepository,
  McpTokenPrismaRepository,
  ToolAuditPrismaRepository,
} from './prisma/repositories/assistant.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The assistant + MCP tables (migration `20261008180000_ai_chat_mcp`) against a real SQLite file:
 * settings round trip, messages numbered in order, proposals decided once, tokens by hash, the
 * audit log, cascades and the hand-written CHECKs. `pnpm ci:integration` — never your dev database.
 */
loadEnv({
  path: ['apps/api/.env.local', 'apps/api/.env', '.env'],
  quiet: true,
});

const config = {
  get: (key: string) =>
    key === 'DATABASE_URL' ? process.env['DATABASE_URL'] : undefined,
} as unknown as ConfigService<Env, true>;

const prisma = new PrismaService(config);
const users = new UserPrismaRepository(prisma);
const settings = new AssistantSettingsPrismaRepository(prisma);
const chats = new ChatPrismaRepository(prisma);
const tokens = new McpTokenPrismaRepository(prisma);
const audit = new ToolAuditPrismaRepository(prisma);

let seq = 0;
async function newUser() {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it-assistant:${Date.now()}:${seq}`,
      email: `assistant${seq}@it.dev`,
      emailVerified: true,
      name: 'Assistant',
      signInProvider: 'dev',
    },
    'Assistant',
  );
}

const sql = (text: string, ...values: unknown[]) =>
  prisma.$executeRawUnsafe(text, ...values);
const NOW = '2026-01-01T00:00:00.000+00:00';

beforeAll(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('assistant settings', () => {
  it('stores the prompt, the chat consent and the MCP switches', async () => {
    const user = await newUser();
    expect(await settings.find(user.id)).toBeNull();
    const saved = await settings.save(user.id, {
      systemPrompt: 'Sei knapp.',
      chatConsentAt: '2026-01-02T03:04:05.000Z',
      mcpEnabled: true,
      mcpAreas: ['results', 'projects', 'results'],
      mcpAllowWrite: false,
    });
    expect(saved).toEqual(
      expect.objectContaining({
        systemPrompt: 'Sei knapp.',
        chatConsentAt: '2026-01-02T03:04:05.000Z',
        mcpEnabled: true,
        mcpAreas: ['projects', 'results'],
        mcpAllowWrite: false,
      }),
    );
    expect(await settings.find(user.id)).toEqual(saved);
  });

  it('keeps the CHECKs (prompt length, areas JSON array)', async () => {
    const user = await newUser();
    const insert = (prompt: string | null, areas: string) =>
      sql(
        `INSERT INTO assistant_settings (user_id, system_prompt, mcp_areas, updated_at) VALUES (?, ?, ?, ?)`,
        user.id,
        prompt,
        areas,
        NOW,
      );
    await expect(insert('', '[]')).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert('x'.repeat(8001), '[]')).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(insert(null, '{}')).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert(null, '["projects"]')).resolves.toBe(1);
  });
});

describe('chat conversations', () => {
  it('numbers messages, stores proposals, decides a proposal once and cascades', async () => {
    const user = await newUser();
    const conversation = await chats.createConversation(user.id, 'Kurs DOT');
    const proposalId = randomUUID();
    await chats.append(
      conversation.id,
      [
        { role: 'user', content: 'Kurs setzen', data: {} },
        {
          role: 'assistant',
          content: 'Bitte bestätigen',
          data: { proposalIds: [proposalId] },
        },
      ],
      [
        {
          id: proposalId,
          tool: 'set_price_override',
          args: { asset: 'DOT' },
          preview: {
            title: 'Kurs überschreiben',
            effect: 'write',
            summary: 'DOT',
            changes: [{ label: 'Kurs', before: null, after: '4.5' }],
          },
        },
      ],
    );
    await chats.append(conversation.id, [
      { role: 'event', content: 'Ausgeführt', data: { proposalId } },
    ]);
    expect(
      (await chats.messages(conversation.id)).map((m) => [m.seq, m.role]),
    ).toEqual([
      [0, 'user'],
      [1, 'assistant'],
      [2, 'event'],
    ]);
    expect(
      (await chats.messages(conversation.id))[1]?.data.proposalIds,
    ).toEqual([proposalId]);

    const first = await chats.decideProposal(proposalId, 'executed', null);
    expect(first?.status).toBe('executed');
    expect(first?.decidedAt).not.toBeNull();
    expect(
      await chats.decideProposal(proposalId, 'cancelled', null),
    ).toBeNull();
    const failed = await chats.setProposalResult(proposalId, 'failed', {
      error: { code: 'conflict', message: 'closed' },
    });
    expect(failed.result).toEqual({
      error: { code: 'conflict', message: 'closed' },
    });

    const renamed = await chats.renameConversation(conversation.id, 'Neu');
    expect(renamed.title).toBe('Neu');
    expect((await chats.listConversations(user.id)).map((c) => c.id)).toEqual([
      conversation.id,
    ]);

    await chats.deleteConversation(conversation.id);
    const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT (SELECT COUNT(*) FROM chat_message WHERE conversation_id = ?) + (SELECT COUNT(*) FROM chat_proposal WHERE conversation_id = ?) AS n',
      conversation.id,
      conversation.id,
    );
    expect(Number(left[0]?.n)).toBe(0);
  });

  it('keeps the CHECKs of messages and proposals', async () => {
    const user = await newUser();
    const conversation = await chats.createConversation(user.id, 'Checks');
    const message = (role: string, data: string) =>
      sql(
        `INSERT INTO chat_message (id, conversation_id, seq, role, content, data, created_at) VALUES (?, ?, ?, ?, '', ?, ?)`,
        randomUUID(),
        conversation.id,
        seq++,
        role,
        data,
        NOW,
      );
    await expect(message('system', '{}')).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(message('user', '[]')).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(message('user', '{}')).resolves.toBe(1);

    const proposal = (status: string, decided: string | null) =>
      sql(
        `INSERT INTO chat_proposal (id, conversation_id, tool, args, preview, status, decided_at, created_at) VALUES (?, ?, 't', '{}', '{}', ?, ?, ?)`,
        randomUUID(),
        conversation.id,
        status,
        decided,
        NOW,
      );
    await expect(proposal('done', null)).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(proposal('executed', null)).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(proposal('pending', NOW)).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(proposal('pending', null)).resolves.toBe(1);
    await expect(
      sql(
        `INSERT INTO chat_conversation (id, user_id, title, created_at, updated_at) VALUES (?, ?, '  ', ?, ?)`,
        randomUUID(),
        user.id,
        NOW,
        NOW,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});

describe('MCP tokens and the tool audit', () => {
  it('finds a token by its hash, touches and revokes it; the audit lists newest first', async () => {
    const user = await newUser();
    const hash = hashMcpToken(`lkmcp_${randomUUID()}`);
    const token = await tokens.create(user.id, {
      name: 'Claude',
      tokenHash: hash,
      tokenHint: '…abcd',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect((await tokens.findByHash(hash))?.id).toBe(token.id);
    await tokens.touch(token.id, '2026-02-01T00:00:00.000Z');
    expect((await tokens.findById(token.id))?.lastUsedAt).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    const revoked = await tokens.revoke(token.id, '2026-03-01T00:00:00.000Z');
    expect(revoked.revokedAt).toBe('2026-03-01T00:00:00.000Z');
    expect((await tokens.listByUser(user.id)).map((t) => t.id)).toEqual([
      token.id,
    ]);

    await audit.add({
      userId: user.id,
      source: 'mcp',
      tool: 'list_projects',
      args: '{}',
      status: 'ok',
      errorCode: null,
      durationMs: 3,
      tokenId: token.id,
    });
    await audit.add({
      userId: user.id,
      source: 'chat',
      tool: 'set_price_override',
      args: '{"asset":"DOT"}',
      status: 'proposed',
      errorCode: null,
      durationMs: 0,
      tokenId: null,
    });
    expect(
      (await audit.listByUser(user.id, { limit: 10 })).map((a) => a.tool),
    ).toEqual(['set_price_override', 'list_projects']);
    expect(
      (await audit.listByUser(user.id, { source: 'mcp', limit: 10 })).map(
        (a) => a.tool,
      ),
    ).toEqual(['list_projects']);
  });

  it('keeps the CHECKs and cascades with the user', async () => {
    const user = await newUser();
    const token = (hash: string, name = 'x', hint = '…x') =>
      sql(
        `INSERT INTO mcp_token (id, user_id, name, token_hash, token_hint, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        user.id,
        name,
        hash,
        hint,
        NOW,
      );
    await expect(token('abc')).rejects.toThrow(/CHECK constraint failed/);
    await expect(token('G'.repeat(64))).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(token('a'.repeat(64), ' ')).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(token('b'.repeat(64), 'ok', '')).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(token('c'.repeat(64))).resolves.toBe(1);

    const row = (source: string, status: string, args = '{}', ms = 1) =>
      sql(
        `INSERT INTO tool_audit (id, user_id, source, tool, args, status, duration_ms, created_at) VALUES (?, ?, ?, 't', ?, ?, ?, ?)`,
        randomUUID(),
        user.id,
        source,
        args,
        status,
        ms,
        NOW,
      );
    await expect(row('web', 'ok')).rejects.toThrow(/CHECK constraint failed/);
    await expect(row('mcp', 'maybe')).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(row('mcp', 'ok', 'x'.repeat(2001))).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(row('mcp', 'ok', '{}', -1)).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(row('chat', 'refused')).resolves.toBe(1);

    await chats.createConversation(user.id, 'Weg');
    await settings.save(user.id, {
      systemPrompt: null,
      chatConsentAt: null,
      mcpEnabled: false,
      mcpAreas: [],
      mcpAllowWrite: false,
    });
    await prisma.user.delete({ where: { id: user.id } });
    const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT (SELECT COUNT(*) FROM mcp_token WHERE user_id = ?) + (SELECT COUNT(*) FROM tool_audit WHERE user_id = ?) + (SELECT COUNT(*) FROM chat_conversation WHERE user_id = ?) + (SELECT COUNT(*) FROM assistant_settings WHERE user_id = ?) AS n`,
      user.id,
      user.id,
      user.id,
      user.id,
    );
    expect(Number(left[0]?.n)).toBe(0);
  });
});
