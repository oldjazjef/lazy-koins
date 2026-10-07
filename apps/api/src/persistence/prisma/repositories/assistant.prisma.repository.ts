import { Injectable } from '@nestjs/common';
import {
  type AssistantSettings,
  cleanAreas,
  type SaveAssistantSettings,
} from '../../../assistant/domain/assistant-settings';
import type {
  ChatMessage,
  ChatMessageData,
  ChatProposal,
  ChatRole,
  Conversation,
  NewChatMessage,
  NewChatProposal,
  ProposalStatus,
} from '../../../assistant/domain/chat';
import {
  AssistantSettingsRepositoryPort,
  ChatRepositoryPort,
} from '../../../assistant/ports/assistant.repository.port';
import type {
  AssistantSettings as AssistantSettingsRow,
  ChatConversation as ConversationRow,
  ChatMessage as MessageRow,
  ChatProposal as ProposalRow,
  McpToken as McpTokenRow,
  ToolAudit as ToolAuditRow,
} from '../../../generated/prisma/client';
import type { McpToken, NewMcpToken } from '../../../mcp/domain/mcp-token';
import { McpTokenRepositoryPort } from '../../../mcp/ports/mcp-token.repository.port';
import type { ToolSource } from '../../../tools/domain/tool';
import type {
  NewToolAuditEntry,
  ToolAuditCriteria,
  ToolAuditEntry,
  ToolAuditStatus,
} from '../../../tools/domain/tool-audit';
import { ToolAuditRepositoryPort } from '../../../tools/ports/tool-audit.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toSettings(row: AssistantSettingsRow): AssistantSettings {
  return {
    userId: row.userId,
    systemPrompt: row.systemPrompt,
    chatConsentAt: row.chatConsentAt ? toIsoString(row.chatConsentAt) : null,
    mcpEnabled: row.mcpEnabled,
    mcpAreas: cleanAreas(parseJson<string[]>(row.mcpAreas, [])),
    mcpAllowWrite: row.mcpAllowWrite,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class AssistantSettingsPrismaRepository extends AssistantSettingsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(userId: string): Promise<AssistantSettings | null> {
    const row = await this.prisma.assistantSettings.findUnique({
      where: { userId },
    });
    return row ? toSettings(row) : null;
  }

  async save(
    userId: string,
    settings: SaveAssistantSettings,
  ): Promise<AssistantSettings> {
    const data = {
      systemPrompt: settings.systemPrompt,
      chatConsentAt: settings.chatConsentAt
        ? new Date(settings.chatConsentAt)
        : null,
      mcpEnabled: settings.mcpEnabled,
      mcpAreas: JSON.stringify(cleanAreas(settings.mcpAreas)),
      mcpAllowWrite: settings.mcpAllowWrite,
    };
    const row = await this.prisma.assistantSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toSettings(row);
  }
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    role: row.role as ChatRole,
    content: row.content,
    data: parseJson<ChatMessageData>(row.data, {}),
    createdAt: toIsoString(row.createdAt),
  };
}

function toProposal(row: ProposalRow): ChatProposal {
  return {
    id: row.id,
    conversationId: row.conversationId,
    tool: row.tool,
    args: parseJson<Record<string, unknown>>(row.args, {}),
    preview: parseJson<ChatProposal['preview']>(row.preview, {
      title: row.tool,
      effect: 'write',
      summary: row.tool,
      changes: [],
    }),
    status: row.status as ProposalStatus,
    result: parseJson<unknown>(row.result, null),
    createdAt: toIsoString(row.createdAt),
    decidedAt: row.decidedAt ? toIsoString(row.decidedAt) : null,
  };
}

@Injectable()
export class ChatPrismaRepository extends ChatRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    const rows = await this.prisma.chatConversation.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toConversation);
  }

  async findConversation(id: string): Promise<Conversation | null> {
    const row = await this.prisma.chatConversation.findUnique({
      where: { id },
    });
    return row ? toConversation(row) : null;
  }

  async createConversation(
    userId: string,
    title: string,
  ): Promise<Conversation> {
    return toConversation(
      await this.prisma.chatConversation.create({ data: { userId, title } }),
    );
  }

  async renameConversation(id: string, title: string): Promise<Conversation> {
    return toConversation(
      await this.prisma.chatConversation.update({
        where: { id },
        data: { title },
      }),
    );
  }

  async deleteConversation(id: string): Promise<void> {
    await this.prisma.chatConversation.deleteMany({ where: { id } });
  }

  async messages(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { seq: 'asc' },
    });
    return rows.map(toMessage);
  }

  async append(
    conversationId: string,
    messages: readonly NewChatMessage[],
    proposals: readonly NewChatProposal[] = [],
  ): Promise<ChatMessage[]> {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.chatMessage.findFirst({
        where: { conversationId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      let seq = last ? last.seq + 1 : 0;
      for (const proposal of proposals) {
        await tx.chatProposal.create({
          data: {
            id: proposal.id,
            conversationId,
            tool: proposal.tool,
            args: JSON.stringify(proposal.args),
            preview: JSON.stringify(proposal.preview),
          },
        });
      }
      const out: ChatMessage[] = [];
      for (const message of messages) {
        const row = await tx.chatMessage.create({
          data: {
            conversationId,
            seq,
            role: message.role,
            content: message.content,
            data: JSON.stringify(message.data),
          },
        });
        seq += 1;
        out.push(toMessage(row));
      }
      await tx.chatConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return out;
    });
  }

  async proposals(conversationId: string): Promise<ChatProposal[]> {
    const rows = await this.prisma.chatProposal.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toProposal);
  }

  async findProposal(id: string): Promise<ChatProposal | null> {
    const row = await this.prisma.chatProposal.findUnique({ where: { id } });
    return row ? toProposal(row) : null;
  }

  async decideProposal(
    id: string,
    status: Exclude<ProposalStatus, 'pending'>,
    result: unknown,
  ): Promise<ChatProposal | null> {
    // Conditional on `pending`: a double click cannot run the tool twice.
    const { count } = await this.prisma.chatProposal.updateMany({
      where: { id, status: 'pending' },
      data: {
        status,
        result: JSON.stringify(result ?? null),
        decidedAt: new Date(),
      },
    });
    if (count === 0) return null;
    return this.findProposal(id);
  }

  async setProposalResult(
    id: string,
    status: Exclude<ProposalStatus, 'pending'>,
    result: unknown,
  ): Promise<ChatProposal> {
    return toProposal(
      await this.prisma.chatProposal.update({
        where: { id },
        data: { status, result: JSON.stringify(result ?? null) },
      }),
    );
  }
}

function toToken(row: McpTokenRow): McpToken {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    tokenHint: row.tokenHint,
    expiresAt: row.expiresAt ? toIsoString(row.expiresAt) : null,
    lastUsedAt: row.lastUsedAt ? toIsoString(row.lastUsedAt) : null,
    revokedAt: row.revokedAt ? toIsoString(row.revokedAt) : null,
    createdAt: toIsoString(row.createdAt),
  };
}

@Injectable()
export class McpTokenPrismaRepository extends McpTokenRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(userId: string, token: NewMcpToken): Promise<McpToken> {
    return toToken(
      await this.prisma.mcpToken.create({
        data: {
          userId,
          name: token.name,
          tokenHash: token.tokenHash,
          tokenHint: token.tokenHint,
          expiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
        },
      }),
    );
  }

  async listByUser(userId: string): Promise<McpToken[]> {
    const rows = await this.prisma.mcpToken.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toToken);
  }

  async findByHash(tokenHash: string): Promise<McpToken | null> {
    const row = await this.prisma.mcpToken.findUnique({
      where: { tokenHash },
    });
    return row ? toToken(row) : null;
  }

  async findById(id: string): Promise<McpToken | null> {
    const row = await this.prisma.mcpToken.findUnique({ where: { id } });
    return row ? toToken(row) : null;
  }

  async revoke(id: string, at: string): Promise<McpToken> {
    return toToken(
      await this.prisma.mcpToken.update({
        where: { id },
        data: { revokedAt: new Date(at) },
      }),
    );
  }

  async touch(id: string, at: string): Promise<void> {
    await this.prisma.mcpToken.updateMany({
      where: { id },
      data: { lastUsedAt: new Date(at) },
    });
  }
}

function toAudit(row: ToolAuditRow): ToolAuditEntry {
  return {
    id: row.id,
    userId: row.userId,
    source: row.source as ToolSource,
    tool: row.tool,
    args: row.args,
    status: row.status as ToolAuditStatus,
    errorCode: row.errorCode,
    durationMs: row.durationMs,
    tokenId: row.tokenId,
    createdAt: toIsoString(row.createdAt),
  };
}

@Injectable()
export class ToolAuditPrismaRepository extends ToolAuditRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async add(entry: NewToolAuditEntry): Promise<ToolAuditEntry> {
    return toAudit(await this.prisma.toolAudit.create({ data: { ...entry } }));
  }

  async listByUser(
    userId: string,
    criteria: ToolAuditCriteria,
  ): Promise<ToolAuditEntry[]> {
    const rows = await this.prisma.toolAudit.findMany({
      where: {
        userId,
        ...(criteria.source ? { source: criteria.source } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: criteria.limit,
    });
    return rows.map(toAudit);
  }
}
